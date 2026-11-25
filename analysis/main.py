"""Pine OS analysis service. Run:  python -m uvicorn main:app --port 5000"""
from __future__ import annotations

import base64
import json
import math
import time

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

import calib as calib_mod
import grade as G
from detect import PROFILES, annotate, detect
import bench

app = FastAPI(title="Pine OS analysis service")
MAX_SIDE = 6000


def _decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "Could not decode image")
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        s = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (int(w * s), int(h * s)), interpolation=cv2.INTER_AREA)
    return img


@app.get("/health")
def health():
    return dict(ok=True, opencv=cv2.__version__, profiles=list(PROFILES))


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    scale_mode: str = Form("ref_width"),  # ref_width | mm_per_px | ref_mean
    mm_per_px: float | None = Form(None),
    ref_width_mm: float = Form(2400.0),
    ref_mean_mm: float | None = Form(None),
    log_length_m: float = Form(3.1),
    rules: str = Form("{}"),
    profile: str = Form("ellipse-v1.3-highrecall"),
    gt: str | None = Form(None),  # optional YOLO-format ground-truth boxes (class cx cy w h, normalised)
):
    t0 = time.time()
    img = _decode(await file.read())
    H, W = img.shape[:2]
    rule = {**G.DEFAULT_RULES, **json.loads(rules or "{}")}

    t1 = time.time()
    if profile not in PROFILES:
        raise HTTPException(400, f"Unknown profile {profile}")
    try:
        logs = detect(img, PROFILES[profile])
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    infer_ms = (time.time() - t1) * 1000
    if not logs:
        raise HTTPException(422, "No log ends detected. Use a clear, near-perpendicular photo of the stacked log ends.")

    scale, scale_desc = G.estimate_scale(logs, scale_mode, mm_per_px, ref_width_mm, ref_mean_mm)

    # stable ordering: top-to-bottom rows, then left-to-right
    mean_r = float(np.mean([(L.a + L.b) / 2 for L in logs]))
    logs.sort(key=lambda L: (round(L.cy / (1.6 * mean_r)), L.cx))

    out, grades, d_list = [], [], []
    labels = {}
    flagged = set()
    for i, L in enumerate(logs):
        major_mm, minor_mm = 2 * L.a * scale, 2 * L.b * scale
        d_mm = 2 * math.sqrt(L.a * L.b) * scale
        oval = L.a / max(L.b, 1e-6)
        crack, rot, bark = L.extra.get("crack"), L.extra.get("rot"), L.extra.get("bark")
        g, why = G.grade_log(d_mm, crack, rot, oval, rule)
        conf = round(min(99.5, 55 + 45 * L.score), 1)
        occluded = L.coverage < 0.8
        d_list.append(d_mm)
        grades.append(g)
        if g in ("C", "R"):
            flagged.add(i)
        labels[i] = f"{i + 1}"
        out.append(dict(
            label=f"LOG-{i + 1:03d}",
            cx_pct=round(100 * L.cx / W, 3), cy_pct=round(100 * L.cy / H, 3),
            rx_pct=round(100 * L.a / W, 3), ry_pct=round(100 * L.b / W, 3),  # both relative to image WIDTH
            angle=round(L.angle, 1),
            major_mm=round(major_mm, 1), minor_mm=round(minor_mm, 1), eq_mm=round(d_mm, 1),
            area_cm2=round(math.pi * (d_mm / 20) ** 2, 1), ovality=round(oval, 3),
            conf=conf, occluded=occluded, bark_pct=bark, crack_pct=crack, rot_pct=rot,
            texture_ok=bool(L.extra.get("texture_ok")), grade=g, grade_why=why,
        ))

    d = np.array(d_list)
    gt_eval, gt_boxes = None, []
    if gt:
        gb = bench.parse_yolo(gt, W, H)
        gt_eval, matched = bench.match_gt(logs, gb)
        for o, m in zip(out, matched):
            o['gt_match'] = m
        gt_boxes = [[round(100 * g[0] / W, 3), round(100 * g[1] / H, 3), round(100 * (g[2] - g[0]) / W, 3), round(100 * (g[3] - g[1]) / H, 3)] for g in gb]
    tg = G.truck_grade(grades, float(d.mean()))
    vol, weight = G.volume_weight(d, log_length_m, rule["wood_density_kg_m3"])
    tex = [o for o in out if o["texture_ok"]]
    ann = annotate(img, logs, flagged, labels)
    ok, buf = cv2.imencode(".jpg", ann, [cv2.IMWRITE_JPEG_QUALITY, 88])
    raw_ok, raw_buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])

    return dict(
        image=dict(width=W, height=H),
        scale=dict(mm_per_px=round(scale, 5), source=scale_desc, mode=scale_mode),
        logs=out,
        summary=dict(
            count=len(out), mean_mm=round(float(d.mean()), 1), median_mm=round(float(np.median(d)), 1), std_mm=round(float(d.std()), 1),
            min_mm=round(float(d.min()), 1), max_mm=round(float(d.max()), 1),
            volume_m3=round(vol, 2), weight_kg=round(weight), log_length_m=log_length_m,
            sub_gauge=int((d < rule["grade_b_min_mm"]).sum()), avg_ovality=round(float(np.mean([o["ovality"] for o in out])), 3),
            avg_bark_pct=round(float(np.mean([o["bark_pct"] for o in out if o["bark_pct"] is not None] or [0])), 2),
            avg_crack_pct=round(float(np.mean([o["crack_pct"] for o in tex] or [0])), 2) if tex else None,
            rot_logs=sum(1 for o in tex if (o["rot_pct"] or 0) >= rule["reject_rot_pct"]),
            texture_measured=len(tex), mean_conf=round(float(np.mean([o["conf"] for o in out])), 1),
        ),
        grade=tg, rules=rule, eval=gt_eval, gt_boxes=gt_boxes,
        timing=dict(total_ms=round((time.time() - t0) * 1000), inference_ms=round(infer_ms)),
        engine=profile,
        annotated_b64=base64.b64encode(buf.tobytes()).decode(),
        raw_b64=base64.b64encode(raw_buf.tobytes()).decode(),
    )


@app.post("/calibrate")
async def calibrate(files: list[UploadFile] = File(...), cols: int = Form(9), rows: int = Form(6), square_mm: float = Form(40.0)):
    imgs = [_decode(await f.read()) for f in files]
    try:
        r = calib_mod.calibrate(imgs, cols, rows, square_mm)
    except ValueError as e:
        raise HTTPException(422, str(e))
    return r


@app.get("/benchmark")
def benchmark(profile: str = "ellipse-v1.3-highrecall"):
    if profile not in PROFILES:
        raise HTTPException(400, "Unknown profile")
    return bench.run(profile)


@app.get("/real-eval")
def real_eval():
    """Measured accuracy of each profile on the real annotated dataset (written by eval_real.py / train_real.py)."""
    import os
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
    out = {}
    for name in PROFILES:
        f = os.path.join(here, f"real_eval_{name}.json")
        if os.path.exists(f):
            s = json.load(open(f))["summary"]
            out[name] = dict(precision=s["precision"], recall=s["recall"], f1=s["f1"], mean_iou=s["mean_iou"], images=s["images"], source="evaluated on all 146 real images (no training)")
    return out
