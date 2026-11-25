"""Benchmark a detector profile on the synthetic pile (ground truth known)."""
from __future__ import annotations

import math
import time

import cv2
import numpy as np

from detect import PROFILES, detect
from synth import make_pile


def _iou(L, t, shape):
    pad = int(2 * max(L.a, t["a"])) + 4
    x0, y0 = int(min(L.cx, t["cx"]) - pad), int(min(L.cy, t["cy"]) - pad)
    x1, y1 = int(max(L.cx, t["cx"]) + pad), int(max(L.cy, t["cy"]) + pad)
    w, h = x1 - x0, y1 - y0
    m1, m2 = np.zeros((h, w), np.uint8), np.zeros((h, w), np.uint8)
    cv2.ellipse(m1, ((L.cx - x0, L.cy - y0), (2 * L.a, 2 * L.b), L.angle), 1, -1)
    cv2.ellipse(m2, ((t["cx"] - x0, t["cy"] - y0), (2 * t["a"] * 0.93, 2 * t["b"] * 0.93), t["angle"]), 1, -1)
    inter, union = (m1 & m2).sum(), (m1 | m2).sum()
    return inter / max(union, 1)


def run(profile: str, seed: int = 11) -> dict:
    img, truth, ppm = make_pile(seed=seed)
    t = time.time()
    logs = detect(img, PROFILES[profile])
    infer_ms = (time.time() - t) * 1000
    used, errs, ious = set(), [], []
    for L in logs:
        cand = [(math.hypot(L.cx - tr["cx"], L.cy - tr["cy"]), j) for j, tr in enumerate(truth) if j not in used]
        if not cand:
            continue
        d, j = min(cand)
        if d < 0.5 * truth[j]["a"]:
            used.add(j)
            errs.append(2 * math.sqrt(L.a * L.b) / ppm - truth[j]["eq_mm"])
            ious.append(_iou(L, truth[j], img.shape))
    tp = len(used)
    prec, rec = tp / max(1, len(logs)), tp / len(truth)
    f1 = 2 * prec * rec / max(prec + rec, 1e-9)
    errs = np.array(errs)
    return dict(profile=profile, truth=len(truth), detected=len(logs), matched=tp,
                precision=round(prec * 100, 1), recall=round(rec * 100, 1), f1=round(f1 * 100, 1),
                mean_iou=round(float(np.mean(ious)) * 100, 1), mae_mm=round(float(np.abs(errs).mean()), 2),
                bias_mm=round(float(errs.mean()), 2), latency_ms=round(infer_ms))


# ---------------------------------------------------------------- ground-truth matching for annotated photos
def parse_yolo(text: str, W: int, H: int):
    """YOLO label text -> list of (x0, y0, x1, y1) in pixels."""
    out = []
    for line in (text or "").splitlines():
        q = line.split()
        if len(q) >= 5:
            _, cx, cy, w, h = map(float, q[:5])
            out.append((cx * W - w * W / 2, cy * H - h * H / 2, cx * W + w * W / 2, cy * H + h * H / 2))
    return out


def _ell_box(L):
    t = math.radians(L.angle)
    hw = math.sqrt((L.a * math.cos(t)) ** 2 + (L.b * math.sin(t)) ** 2)
    hh = math.sqrt((L.a * math.sin(t)) ** 2 + (L.b * math.cos(t)) ** 2)
    return (L.cx - hw, L.cy - hh, L.cx + hw, L.cy + hh)


def _box_iou(a, b):
    ix, iy = max(0, min(a[2], b[2]) - max(a[0], b[0])), max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def match_gt(logs, gt_boxes, thr=0.5):
    """Greedy IoU matching. Returns metrics plus, per detection, the matched GT index (or -1)."""
    pb = [_ell_box(L) for L in logs]
    pairs = sorted(((_box_iou(pb[i], gt_boxes[j]), i, j) for i in range(len(pb)) for j in range(len(gt_boxes))), reverse=True)
    ui, uj, ious, ratios = {}, set(), [], []
    for v, i, j in pairs:
        if v < thr:
            break
        if i in ui or j in uj:
            continue
        ui[i] = j
        uj.add(j)
        ious.append(v)
        g = gt_boxes[j]
        ratios.append(2 * math.sqrt(logs[i].a * logs[i].b) / (((g[2] - g[0]) + (g[3] - g[1])) / 2))
    tp, fp, fn = len(ui), len(pb) - len(ui), len(gt_boxes) - len(uj)
    P, R = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return dict(gt=len(gt_boxes), detected=len(pb), tp=tp, fp=fp, fn=fn, precision=round(100 * P, 1), recall=round(100 * R, 1),
                f1=round(200 * P * R / max(P + R, 1e-9), 1), mean_iou=round(100 * float(np.mean(ious)), 1) if ious else None,
                diameter_ratio=round(float(np.median(ratios)), 3) if ratios else None), [ui.get(i, -1) for i in range(len(pb))]
