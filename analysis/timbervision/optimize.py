"""Try ways to get more out of the TimberVision model without retraining, and measure them.

Variants (all merged with the same duplicate removal):
  base        one pass at 1024 px (what the app does)
  full1280    one pass at 1280 px            full1600   one pass at 1600 px
  flip        1024 pass + mirrored 1024 pass
  tiles2      1024 pass + 2x2 overlapping tiles (each tile at 1024, i.e. ~2x zoom)
  tiles2c     tiles2 on a contrast-enhanced copy (CLAHE), for night / haze
  tiles3      1024 pass + 2x2 tiles + 3x3 tiles

  analysis/.venv-tv/Scripts/python analysis/timbervision/optimize.py eval <diif_dataset_dir> <out.json> [n_images]
  analysis/.venv-tv/Scripts/python analysis/timbervision/optimize.py show <photo_dir> <out_dir> <variant> <photo>...

'eval' scores every variant against the DIIF human boxes (IoU >= 0.5). Those labels skip many tiny log ends, so extra
correct small detections count as false positives there: read recall first, precision with that in mind.
"""
import glob
import json
import os
import random
import sys
import time

import cv2
import numpy as np
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
model = YOLO(os.path.join(HERE, "yolov8l-1024-seg.pt"))
CUT = [k for k, v in model.names.items() if v == "cut"][0]
CONF_MIN = 0.2


def clahe(img):
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    lab[:, :, 0] = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8)).apply(lab[:, :, 0])
    return cv2.cvtColor(lab, cv2.COLOR_LAB2BGR)


def predict(img, imgsz, ox=0, oy=0, inner=(), flip=False):
    """One model pass. Returns detections in full-image pixels. Detections touching an inner tile edge are dropped
    (another tile or the full pass sees that log whole)."""
    src = img[:, ::-1] if flip else img
    h, w = img.shape[:2]
    r = model.predict(np.ascontiguousarray(src), imgsz=imgsz, conf=CONF_MIN, verbose=False, device="cpu")[0]
    out = []
    if r.masks is None:
        return out
    for j in range(len(r.boxes)):
        if int(r.boxes.cls[j]) != CUT:
            continue
        pts = r.masks.xy[j]
        if pts is None or len(pts) < 5:
            continue
        pts = pts.astype(np.float32).copy()
        if flip:
            pts[:, 0] = w - pts[:, 0]
        x0, y0, x1, y1 = pts[:, 0].min(), pts[:, 1].min(), pts[:, 0].max(), pts[:, 1].max()
        # the mask outline of a log cut by the tile edge often stops a few model pixels short of the edge,
        # so "touching" is judged with a margin of 1% of the tile size (3 px let half-logs through)
        m = max(3.0, 0.01 * max(w, h))
        if ("l" in inner and x0 < m) or ("r" in inner and x1 > w - m) or ("t" in inner and y0 < m) or ("b" in inner and y1 > h - m):
            continue
        pts[:, 0] += ox
        pts[:, 1] += oy
        out.append(dict(box=[x0 + ox, y0 + oy, x1 + ox, y1 + oy], conf=float(r.boxes.conf[j]), poly=pts))
    return out


def tiles(img, g, ov=0.25, imgsz=1024):
    H, W = img.shape[:2]
    tw, th = int(W / (g - (g - 1) * ov)), int(H / (g - (g - 1) * ov))
    out = []
    for iy in range(g):
        for ix in range(g):
            x0 = min(W - tw, int(ix * tw * (1 - ov)))
            y0 = min(H - th, int(iy * th * (1 - ov)))
            inner = [s for s, cond in (("l", ix > 0), ("r", ix < g - 1), ("t", iy > 0), ("b", iy < g - 1)) if cond]
            out += predict(img[y0:y0 + th, x0:x0 + tw], imgsz, x0, y0, inner)
    return out


def box_iou(a, b):
    ix, iy = max(0, min(a[2], b[2]) - max(a[0], b[0])), max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def merge(dets):
    """Keep the most confident detection of each log: drop overlaps (IoU > 0.45) and pieces lying inside a kept log."""
    kept = []
    for d in sorted(dets, key=lambda d: -d["conf"]):
        b = d["box"]
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        area = (b[2] - b[0]) * (b[3] - b[1])
        dup = False
        for k in kept:
            kb = k["box"]
            if box_iou(b, kb) > 0.45:
                dup = True
                break
            ix, iy = max(0, min(b[2], kb[2]) - max(b[0], kb[0])), max(0, min(b[3], kb[3]) - max(b[1], kb[1]))
            kcx, kcy, krx, kry = (kb[0] + kb[2]) / 2, (kb[1] + kb[3]) / 2, (kb[2] - kb[0]) / 2, (kb[3] - kb[1]) / 2
            inside = ((cx - kcx) / max(krx, 1)) ** 2 + ((cy - kcy) / max(kry, 1)) ** 2 < 0.64
            if inside and ix * iy > 0.6 * area:
                dup = True
                break
        if not dup:
            kept.append(d)
    return kept


def run(img, variant):
    if variant == "base":
        d = predict(img, 1024)
    elif variant == "full1280":
        d = predict(img, 1280)
    elif variant == "full1600":
        d = predict(img, 1600)
    elif variant == "flip":
        d = predict(img, 1024) + predict(img, 1024, flip=True)
    elif variant == "tiles2":
        d = predict(img, 1024) + tiles(img, 2)
    elif variant == "tiles2c":
        e = clahe(img)
        d = predict(e, 1024) + tiles(e, 2)
    elif variant == "tiles3":
        d = predict(img, 1024) + tiles(img, 2) + tiles(img, 3)
    else:
        raise ValueError(variant)
    return merge(d)


VARIANTS = ["base", "full1280", "full1600", "flip", "tiles2", "tiles2c", "tiles3"]


def evaluate(cache, variant, thr):
    tp = fp = fn = 0
    for c in cache:
        pb = [d for d in c["dets"][variant] if d["conf"] >= thr]
        gt = c["gt"]
        pairs = sorted(((box_iou(pb[i]["box"], gt[j]), i, j) for i in range(len(pb)) for j in range(len(gt))), reverse=True)
        ui, uj = set(), set()
        for v, i, j in pairs:
            if v < 0.5:
                break
            if i in ui or j in uj:
                continue
            ui.add(i)
            uj.add(j)
        tp += len(ui)
        fp += len(pb) - len(ui)
        fn += len(gt) - len(uj)
    P, R = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return dict(conf=thr, found=tp + fp, precision=round(100 * P, 1), recall=round(100 * R, 1), f1=round(200 * P * R / max(P + R, 1e-9), 1))


if sys.argv[1] == "eval":
    ds, out_path = sys.argv[2], sys.argv[3]
    n = int(sys.argv[4]) if len(sys.argv) > 4 else 40
    imgs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(ds, "annotated_dataset", "images", "*", "*"))}
    labs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(ds, "annotated_dataset", "labels", "*", "*.txt"))}
    keys = [k for k in imgs if k in labs]
    count = {k: sum(1 for l in open(labs[k]) if len(l.split()) >= 5) for k in keys}
    dense = sorted(keys, key=lambda k: -count[k])[: n // 2]
    rest = [k for k in sorted(keys) if k not in dense]
    random.Random(7).shuffle(rest)
    keys = dense + rest[: n - len(dense)]
    cache, secs = [], {v: 0.0 for v in VARIANTS}
    t0 = time.time()
    for i, k in enumerate(keys):
        img = cv2.imdecode(np.fromfile(imgs[k], np.uint8), cv2.IMREAD_COLOR)
        H, W = img.shape[:2]
        gt = []
        for line in open(labs[k]):
            q = line.split()
            if len(q) >= 5:
                _, cx, cy, w, h = map(float, q[:5])
                gt.append([(cx - w / 2) * W, (cy - h / 2) * H, (cx + w / 2) * W, (cy + h / 2) * H])
        dets = {}
        for v in VARIANTS:
            t = time.time()
            dets[v] = [dict(box=d["box"], conf=d["conf"]) for d in run(img, v)]
            secs[v] += time.time() - t
        cache.append(dict(image=k, gt=gt, dets=dets))
        print(f"{i + 1}/{len(keys)} {k} gt={len(gt)} " + " ".join(f"{v}={len(dets[v])}" for v in VARIANTS) + f"  ({time.time() - t0:.0f}s)", flush=True)
    res = {}
    for v in VARIANTS:
        sweep = [evaluate(cache, v, t) for t in (0.25, 0.3, 0.4, 0.5)]
        res[v] = dict(sec_per_image=round(secs[v] / len(cache), 1), at_conf_0_4=sweep[2], best_f1=max(sweep, key=lambda s: s["f1"]), sweep=sweep)
        print(v, json.dumps(res[v]["at_conf_0_4"]), "best", json.dumps(res[v]["best_f1"]), f"{res[v]['sec_per_image']}s/img", flush=True)
    json.dump(dict(images=len(cache), gt_boxes=sum(len(c["gt"]) for c in cache), variants=res), open(out_path, "w"), indent=1)

elif sys.argv[1] == "show":
    src, out_dir, variant = sys.argv[2], sys.argv[3], sys.argv[4]
    os.makedirs(out_dir, exist_ok=True)
    for name in sys.argv[5:]:
        img = cv2.imdecode(np.fromfile(os.path.join(src, name), np.uint8), cv2.IMREAD_COLOR)
        panels = []
        for v in ("base", variant):
            t = time.time()
            dets = [d for d in run(img, v) if d["conf"] >= 0.3]
            sec = time.time() - t
            o = img.copy()
            th = max(2, img.shape[1] // 600)
            cv2.polylines(o, [d["poly"].astype(np.int32) for d in dets], True, (60, 220, 60), th, cv2.LINE_AA)
            cv2.rectangle(o, (0, 0), (o.shape[1], 44), (23, 63, 53), -1)
            cv2.putText(o, f"{v}: {len(dets)} logs ({sec:.0f}s)", (10, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
            panels.append(o)
            print(name, v, len(dets), f"{sec:.1f}s", flush=True)
        sheet = np.hstack(panels)
        s = min(1.0, 2400 / sheet.shape[1])
        cv2.imwrite(os.path.join(out_dir, os.path.splitext(name)[0] + f"_{variant}.jpg"), cv2.resize(sheet, None, fx=s, fy=s), [cv2.IMWRITE_JPEG_QUALITY, 85])
