"""Log-end detection and measurement (classical computer vision, OpenCV).

Pipeline
  1. Hough circle candidates on a contrast-normalised grey image.
  2. Each candidate is refined by casting rays from its centre and locating the
     strongest outward intensity drop (log end -> gap/bark); an ellipse is fitted
     to those boundary points.
  3. Candidates are scored (edge coverage + contrast), de-duplicated and filtered
     for size consistency.
  4. Per-log metrics: major/minor axis, equivalent diameter, bark ratio, crack
     index, heart-rot index, confidence, occlusion.

All geometry is returned in *original image pixel* coordinates.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import cv2
import numpy as np

WORK_WIDTH = 1600  # detection resolution; small photos are upscaled to this


@dataclass
class Params:
    min_r_frac: float = 0.006  # of working width
    max_r_frac: float = 0.060
    hough_param2: float = 0.80  # HOUGH_GRADIENT_ALT circle "perfectness"
    min_score: float = 0.42
    rays: int = 48
    require_wood: bool = True
    min_wood_frac: float = 0.45
    min_neighbors: int = 4
    size_lo: float = 0.55  # accepted radius band relative to the dominant log size
    size_hi: float = 1.75
    nms_by_size: bool = False  # rank by score*sqrt(area) so a whole end-face beats the growth rings inside it
    min_edge_strength: float = 0.0  # mean edge contrast (0..1) required on the ellipse boundary
    model: str | None = None  # path of a trained candidate verifier (joblib); when set, it replaces the hand-tuned filters
    model_thr: float = 0.5
    remote: str | None = None  # URL of a detector worker (TimberVision) that returns ellipses
    remote_conf: float = 0.4
    roi: tuple | None = None  # (x0, y0, x1, y1) fractions of the image, optional


@dataclass
class Log:
    cx: float
    cy: float
    a: float  # semi-major (px, original image)
    b: float  # semi-minor
    angle: float  # degrees
    score: float
    coverage: float
    extra: dict = field(default_factory=dict)


def _prep(img_bgr: np.ndarray):
    h, w = img_bgr.shape[:2]
    s = WORK_WIDTH / w
    work = cv2.resize(img_bgr, (WORK_WIDTH, int(round(h * s))), interpolation=cv2.INTER_CUBIC if s > 1 else cv2.INTER_AREA)
    gray = cv2.cvtColor(work, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(gray)
    gray = cv2.GaussianBlur(gray, (0, 0), 1.6)
    return work, gray, s


def _ray_boundary(gray_f: np.ndarray, cx: float, cy: float, r: float, n: int):
    """For each ray find the radius of the strongest outward brightness drop."""
    h, w = gray_f.shape
    pts, strengths = [], []
    rs = np.linspace(0.55 * r, 1.55 * r, 41)
    for k in range(n):
        t = 2 * math.pi * k / n
        xs = cx + rs * math.cos(t)
        ys = cy + rs * math.sin(t)
        if xs.min() < 1 or ys.min() < 1 or xs.max() > w - 2 or ys.max() > h - 2:
            pts.append(None)
            strengths.append(0.0)
            continue
        prof = cv2.remap(gray_f, xs.astype(np.float32).reshape(1, -1), ys.astype(np.float32).reshape(1, -1), cv2.INTER_LINEAR).ravel()
        d = prof[:-3] - prof[3:]  # positive where intensity falls outward
        i = int(np.argmax(d))
        j = i + 1.5
        pts.append((float(np.interp(j, np.arange(len(xs)), xs)), float(np.interp(j, np.arange(len(ys)), ys))))
        strengths.append(float(d[i]))
    return pts, np.array(strengths)


def _fit(gray_f, cx, cy, r, n):
    pts, st = _ray_boundary(gray_f, cx, cy, r, n)
    ok = [(p, s) for p, s in zip(pts, st) if p is not None and s > 6.0]
    if len(ok) < max(10, int(0.5 * n)):
        return None
    P = np.array([p for p, _ in ok], dtype=np.float32)
    S = np.array([s for _, s in ok])
    d = np.hypot(P[:, 0] - cx, P[:, 1] - cy)
    med = np.median(d)
    keep = np.abs(d - med) < 0.28 * med
    if keep.sum() < 8:
        return None
    ell = cv2.fitEllipse(P[keep].reshape(-1, 1, 2))
    (ex, ey), (d1, d2), ang = ell
    if d1 < d2:  # normalise so that the first axis is the major axis
        d1, d2, ang = d2, d1, ang + 90
    ang = ang % 180
    a, b = d1 / 2, d2 / 2
    if b < 0.55 * r or a > 1.7 * r or a / max(b, 1e-3) > 1.6:
        return None
    # residual of boundary points against the fitted ellipse
    ca, sa = math.cos(math.radians(ang)), math.sin(math.radians(ang))
    dx, dy = P[keep, 0] - ex, P[keep, 1] - ey
    u = (dx * ca + dy * sa) / (d1 / 2)
    v = (-dx * sa + dy * ca) / (d2 / 2)
    resid = float(np.mean(np.abs(np.hypot(u, v) - 1)))
    coverage = keep.sum() / n
    contrast = float(np.clip(np.mean(S[keep]) / 45.0, 0, 1))
    score = coverage * (0.55 + 0.45 * contrast) * max(0.0, 1 - 2.2 * resid)
    return ex, ey, d1 / 2, d2 / 2, ang, score, coverage, contrast, resid


def _wood_mask(work_bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(work_bgr, cv2.COLOR_BGR2HSV)
    h, sat, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    m = ((h >= 3) & (h <= 40) & (sat >= 26) & (v >= 70)).astype(np.uint8) * 255
    return cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3)))


def _dt_candidates(mask: np.ndarray, min_r: int, max_r: int):
    dt = cv2.distanceTransform(mask, cv2.DIST_L2, 5)
    k = max(3, int(min_r * 1.4) | 1)
    peak = (dt == cv2.dilate(dt, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))) & (dt >= 0.8 * min_r)
    ys, xs = np.nonzero(peak)
    return [(float(x), float(y), float(np.clip(dt[y, x] * 1.12, min_r, max_r))) for x, y in zip(xs, ys)]


def _ellipse_mask(shape, cx, cy, a, b, ang, scale=1.0):
    m = np.zeros(shape, np.uint8)
    cv2.ellipse(m, ((cx, cy), (2 * a * scale, 2 * b * scale), ang), 255, -1)
    return m


def _nms(cands, shape, max_cover=0.28, by_size=False):
    """Greedy, best score first. A candidate is dropped when too much of its area is already covered by accepted ellipses
    (this removes duplicates, circles squeezed into gaps between logs, and circles spanning two logs)."""
    cands = sorted(cands, key=(lambda c: -c[5] * math.sqrt(c[2] * c[3])) if by_size else (lambda c: -c[5]))
    covered = np.zeros(shape, np.uint8)
    kept = []
    for c in cands:
        ex, ey, a, b, ang = c[:5]
        pad = int(a * 1.2) + 2
        x0, y0 = max(0, int(ex - pad)), max(0, int(ey - pad))
        x1, y1 = min(shape[1], int(ex + pad)), min(shape[0], int(ey + pad))
        if x1 - x0 < 3 or y1 - y0 < 3:
            continue
        m = np.zeros((y1 - y0, x1 - x0), np.uint8)
        cv2.ellipse(m, ((ex - x0, ey - y0), (2 * a, 2 * b), ang), 1, -1)
        area = int(m.sum())
        if area == 0:
            continue
        inter = int((m & covered[y0:y1, x0:x1]).sum())
        if inter / area > max_cover:
            continue
        covered[y0:y1, x0:x1] |= m
        kept.append(c)
    return kept


def detect(img_bgr: np.ndarray, params: Params | None = None) -> list[Log]:
    p = params or Params()
    if p.remote:
        return detect_remote(img_bgr, p)
    if p.model:
        return detect_ml(img_bgr, p)
    work, gray, s = _prep(img_bgr)
    H, W = gray.shape
    if p.roi:
        x0, y0, x1, y1 = p.roi
        roi_mask = np.zeros_like(gray)
        roi_mask[int(y0 * H):int(y1 * H), int(x0 * W):int(x1 * W)] = 255
    else:
        roi_mask = None

    min_r, max_r = int(p.min_r_frac * W), int(p.max_r_frac * W)
    seeds = []
    for p2 in (p.hough_param2, p.hough_param2 - 0.1):
        circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT_ALT, dp=1.5, minDist=max(4, int(min_r * 1.1)),
                                   param1=300, param2=p2, minRadius=min_r, maxRadius=max_r)
        if circles is not None:
            seeds += [tuple(c) for c in circles[0]]
    wood = _wood_mask(work)
    seeds += _dt_candidates(wood, min_r, max_r)
    if not seeds:
        return []
    gray_f = gray.astype(np.float32)
    cands = []
    for cx, cy, r in seeds:
        if roi_mask is not None and roi_mask[int(np.clip(cy, 0, H - 1)), int(np.clip(cx, 0, W - 1))] == 0:
            continue
        f = _fit(gray_f, float(cx), float(cy), float(r), p.rays)
        if not (f and f[5] >= p.min_score):
            continue
        if p.require_wood:
            inner = _ellipse_mask(gray.shape, f[0], f[1], f[2], f[3], f[4], 0.8) > 0
            if inner.sum() == 0 or float((wood[inner] > 0).mean()) < p.min_wood_frac:
                continue
        cands.append(f)
    if not cands:
        return []
    cands = _nms(cands, gray.shape, by_size=p.nms_by_size)

    # size consistency: discard detections far from the dominant log size
    rad = np.array([(c[2] + c[3]) / 2 for c in cands])
    top = rad[np.argsort([-c[5] for c in cands])[: max(5, len(cands) // 3)]]
    ref = float(np.median(top))
    cands = [c for c in cands if p.size_lo * ref <= (c[2] + c[3]) / 2 <= p.size_hi * ref]
    # a real end-face sits in a pile: require several similar-sized neighbours nearby
    if len(cands) > 6 and p.min_neighbors > 0:
        C = np.array([(c[0], c[1]) for c in cands])
        D = np.hypot(C[:, None, 0] - C[None, :, 0], C[:, None, 1] - C[None, :, 1])
        nb = (D < 3.4 * ref).sum(axis=1) - 1
        cands = [c for c, n in zip(cands, nb) if n >= p.min_neighbors]

    logs = []
    for ex, ey, a, b, ang, score, cov, *_ in cands:
        logs.append(Log(ex / s, ey / s, a / s, b / s, ang, float(score), float(cov)))
    _measure_texture(img_bgr, logs)
    return logs


# ---------------------------------------------------------------- learned candidate verifier
FEATURES = ["a_rel", "b_rel", "axis_ratio", "size_vs_ref", "score", "coverage", "contrast", "resid", "h_in", "s_in", "v_in", "v_std_in",
            "s_out", "v_out", "dv", "wood_in", "wood_out", "lap_in", "dark_out", "edge_ring"]

WIDE = Params(min_r_frac=0.008, max_r_frac=0.42, min_score=0.30, require_wood=False, min_neighbors=0, size_lo=0.0, size_hi=1e9, hough_param2=0.70)


def _dedupe(cands):
    """Light de-duplication that still keeps competing hypotheses (nested rings, neighbouring logs)."""
    cands = sorted(cands, key=lambda c: -c[5])
    kept = []
    for c in cands:
        ra = (c[2] + c[3]) / 2
        if any(math.hypot(c[0] - k[0], c[1] - k[1]) < 0.25 * ra and 0.8 < ra / ((k[2] + k[3]) / 2) < 1.25 for k in kept):
            continue
        kept.append(c)
    return kept


def generate(img_bgr: np.ndarray, p: Params | None = None):
    """Returns (work_scale, [(candidate_tuple, feature_vector)]) for every plausible ellipse (no filtering by wood/size)."""
    p = p or WIDE
    work, gray, s = _prep(img_bgr)
    H, W = gray.shape
    min_r, max_r = int(p.min_r_frac * W), int(p.max_r_frac * W)
    seeds = []
    for p2 in (p.hough_param2, p.hough_param2 - 0.1):
        circles = cv2.HoughCircles(gray, cv2.HOUGH_GRADIENT_ALT, dp=1.5, minDist=max(4, int(min_r * 1.1)), param1=300, param2=p2, minRadius=min_r, maxRadius=max_r)
        if circles is not None:
            seeds += [tuple(c) for c in circles[0]]
    wood = _wood_mask(work)
    seeds += _dt_candidates(wood, min_r, max_r)
    gray_f = gray.astype(np.float32)
    cands = []
    for cx, cy, r in seeds:
        f = _fit(gray_f, float(cx), float(cy), float(r), p.rays)
        if f and f[5] >= p.min_score:
            cands.append(f)
    cands = _dedupe(cands)
    if not cands:
        return s, []
    top = np.array([(c[2] + c[3]) / 2 for c in sorted(cands, key=lambda c: -c[5])[: max(5, len(cands) // 3)]])
    ref = float(np.median(top))
    hsv = cv2.cvtColor(work, cv2.COLOR_BGR2HSV)
    lap = cv2.Laplacian(gray, cv2.CV_32F)
    out = []
    for c in cands:
        out.append((c, _cand_features(c, gray, hsv, wood, lap, W, H, ref)))
    return s, out


def _cand_features(c, gray, hsv, wood, lap, W, H, ref):
    ex, ey, a, b, ang, score, cov, contrast, resid = c
    pad = int(a * 1.6) + 3
    x0, y0 = max(0, int(ex - pad)), max(0, int(ey - pad))
    x1, y1 = min(W, int(ex + pad)), min(H, int(ey + pad))
    sh = (y1 - y0, x1 - x0)
    cx, cy = ex - x0, ey - y0
    inner = _ellipse_mask(sh, cx, cy, a, b, ang, 0.8) > 0
    outer = (_ellipse_mask(sh, cx, cy, a, b, ang, 1.45) > 0) & ~(_ellipse_mask(sh, cx, cy, a, b, ang, 1.12) > 0)
    ring = (_ellipse_mask(sh, cx, cy, a, b, ang, 1.06) > 0) & ~(_ellipse_mask(sh, cx, cy, a, b, ang, 0.9) > 0)
    h = hsv[y0:y1, x0:x1, 0].astype(np.float32)
    sa = hsv[y0:y1, x0:x1, 1].astype(np.float32)
    v = hsv[y0:y1, x0:x1, 2].astype(np.float32)
    w = wood[y0:y1, x0:x1] > 0
    l = np.abs(lap[y0:y1, x0:x1])
    ni, no, nr = max(1, int(inner.sum())), max(1, int(outer.sum())), max(1, int(ring.sum()))
    v_in, v_out = float(v[inner].mean()) if inner.any() else 0.0, float(v[outer].mean()) if outer.any() else 0.0
    return np.array([
        a / W, b / W, b / max(a, 1e-6), ((a + b) / 2) / max(ref, 1e-6), score, cov, contrast, resid,
        float(h[inner].mean()) if inner.any() else 0.0, float(sa[inner].mean()) if inner.any() else 0.0, v_in, float(v[inner].std()) if inner.any() else 0.0,
        float(sa[outer].mean()) if outer.any() else 0.0, v_out, v_in - v_out, float(w[inner].sum()) / ni, float(w[outer].sum()) / no,
        float(l[inner].mean()) / (v_in + 1.0) if inner.any() else 0.0, float((v[outer] < 0.7 * max(v_in, 1.0)).sum()) / no,
        float(v[ring].mean() - v[inner].mean()) if ring.any() and inner.any() else 0.0,
    ], dtype=np.float32)


_MODELS: dict = {}


def _load_model(path: str):
    if path not in _MODELS:
        import joblib
        _MODELS[path] = joblib.load(path)
    return _MODELS[path]


def detect_remote(img_bgr: np.ndarray, p: Params) -> list[Log]:
    """Ask an external worker (e.g. TimberVision YOLOv8-seg in its own virtualenv) for log-end ellipses."""
    import json
    import urllib.error
    import urllib.request
    import uuid

    ok, buf = cv2.imencode(".jpg", img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 92])
    b = uuid.uuid4().hex
    body = b"".join([
        f'--{b}\r\nContent-Disposition: form-data; name="conf"\r\n\r\n{p.remote_conf}\r\n'.encode(),
        f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="img.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode(), buf.tobytes(), f"\r\n--{b}--\r\n".encode(),
    ])
    req = urllib.request.Request(p.remote + "/detect", data=body, headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            res = json.loads(r.read())
    except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
        raise RuntimeError(f"TimberVision worker is not reachable at {p.remote} ({e}). Start it with npm run dev after installing analysis/.venv-tv.")
    logs = [Log(e["cx"], e["cy"], e["a"], e["b"], e["angle"], float(e["conf"]), 1.0) for e in res["ellipses"]]
    _measure_texture(img_bgr, logs)
    return logs


def detect_ml(img_bgr: np.ndarray, p: Params) -> list[Log]:
    s, gen = generate(img_bgr)
    if not gen:
        return []
    clf = _load_model(p.model)
    F = np.stack([f for _, f in gen])
    prob = clf.predict_proba(F)[:, 1]
    keep = [(c[:5] + (float(pr), c[6]) + c[7:], pr) for (c, _), pr in zip(gen, prob) if pr >= p.model_thr]
    cands = _nms([k[0] for k in keep], (int(img_bgr.shape[0] * s) + 1, int(img_bgr.shape[1] * s) + 1), max_cover=0.35, by_size=True)
    logs = [Log(c[0] / s, c[1] / s, c[2] / s, c[3] / s, c[4], float(c[5]), float(c[6])) for c in cands]
    _measure_texture(img_bgr, logs)
    return logs


# ---------------------------------------------------------------- per-log texture metrics
def _measure_texture(img_bgr: np.ndarray, logs: list[Log]):
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    grey = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    H, W = grey.shape
    for L in logs:
        r_px = (L.a + L.b) / 2
        x0, x1 = int(max(0, L.cx - 1.3 * L.a)), int(min(W, L.cx + 1.3 * L.a + 1))
        y0, y1 = int(max(0, L.cy - 1.3 * L.a)), int(min(H, L.cy + 1.3 * L.a + 1))
        if x1 - x0 < 6 or y1 - y0 < 6:
            L.extra = dict(bark=None, crack=None, rot=None, texture_ok=False)
            continue
        g = grey[y0:y1, x0:x1]
        v = hsv[y0:y1, x0:x1, 2].astype(np.float32)
        sat = hsv[y0:y1, x0:x1, 1].astype(np.float32)
        cx, cy = L.cx - x0, L.cy - y0
        shp = g.shape
        full = _ellipse_mask(shp, cx, cy, L.a, L.b, L.angle, 1.0) > 0
        inner = _ellipse_mask(shp, cx, cy, L.a, L.b, L.angle, 0.82) > 0
        core = _ellipse_mask(shp, cx, cy, L.a, L.b, L.angle, 0.5) > 0
        ring = full & ~inner
        if inner.sum() < 20 or ring.sum() < 10:
            L.extra = dict(bark=None, crack=None, rot=None, texture_ok=False)
            continue
        med_in = float(np.median(v[inner]))
        # bark: dark outer rim relative to the end-face brightness
        bark = float(np.mean(v[ring] < 0.62 * med_in)) * 100.0 if r_px >= 10 else None  # rim is <2px below this
        texture_ok = r_px >= 16  # too few pixels on the end-face below this
        crack = rot = None
        if texture_ok:
            ring_med = float(np.median(v[inner & ~core])) if (inner & ~core).sum() > 10 else med_in
            ring_sat = float(np.median(sat[inner & ~core])) if (inner & ~core).sum() > 10 else 0
            dark = (v < 0.68 * ring_med) & (sat < 0.8 * max(ring_sat, 1)) & core
            core_dark = float(dark.sum() / max(1, core.sum()))
            rot = core_dark * 100.0 * 0.25  # the 50%-radius core is 25% of the end-face area
            # crack: dark, thin, connected ridge; length is reported as % of the end-face diameter
            k = max(3, int(r_px / 6) | 1)
            bh = cv2.morphologyEx(g, cv2.MORPH_BLACKHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
            ridge = ((bh > max(30.0, 0.32 * med_in)) & inner).astype(np.uint8)
            if core_dark > 0.2:  # the rim of a rot patch is not a crack
                ridge[_ellipse_mask(shp, cx, cy, L.a, L.b, L.angle, 0.65) > 0] = 0
            n_cc, _, stats, _ = cv2.connectedComponentsWithStats(ridge, connectivity=8)
            longest = max((float(np.hypot(stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT])) for i in range(1, n_cc) if stats[i, cv2.CC_STAT_AREA] >= 4), default=0.0)
            crack = min(100.0, longest / max(2 * r_px, 1) * 100.0)
        L.extra = dict(bark=None if bark is None else round(bark, 1), crack=None if crack is None else round(crack, 1),
                       rot=None if rot is None else round(rot, 1), texture_ok=texture_ok)


def annotate(img_bgr: np.ndarray, logs: list[Log], flagged_ids: set[int], labels: dict[int, str] | None = None) -> np.ndarray:
    out = img_bgr.copy()
    th = max(1, int(round(img_bgr.shape[1] / 900)))
    for i, L in enumerate(logs):
        bad = i in flagged_ids
        col = (76, 76, 201) if bad else (108, 198, 164)  # BGR
        ell = ((L.cx, L.cy), (2 * L.a, 2 * L.b), L.angle)
        ov = out.copy()
        cv2.ellipse(ov, ell, col, -1)
        cv2.addWeighted(ov, 0.12 if not bad else 0.28, out, 0.88 if not bad else 0.72, 0, out)
        cv2.ellipse(out, ell, col, th + (1 if bad else 0), cv2.LINE_AA)
        if labels and i in labels:
            cv2.putText(out, labels[i], (int(L.cx - L.a), int(L.cy - L.a - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.35 * th + 0.1, (255, 255, 255), th, cv2.LINE_AA)
    return out


# Named parameter profiles: these play the role of "model versions" in the Models screen.
PROFILES = {
    "ellipse-v1.3-highrecall": Params(min_score=0.34, min_neighbors=3, hough_param2=0.70),
    "ellipse-v1.4-wild": Params(min_r_frac=0.008, max_r_frac=0.42, min_score=0.5, min_neighbors=0, size_lo=0.25, size_hi=4.0, nms_by_size=True, min_wood_frac=0.5),
}


# TimberVision (https://github.com/timbervision/timbervision, v1.0.0 weights): used through analysis/timbervision/worker.py
def _register_timbervision():
    import os
    here = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(here, "timbervision", "yolov8l-1024-seg.pt")):
        PROFILES["timbervision-v1.0-seg"] = Params(remote=os.environ.get("TIMBERVISION_URL", "http://localhost:5001"), remote_conf=0.4)


_register_timbervision()
