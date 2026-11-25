"""Score the TimberVision segmentation model (class 'cut' = log end face) on the DIIF ground-truth boxes.

  analysis/.venv-tv/Scripts/python analysis/timbervision/eval_timbervision.py <dataset_dir> <out.json> [--model seg|obb]

Predictions are cached (conf >= 0.25) and then thresholded, so the sweep is cheap. Matching: greedy IoU >= 0.5 between the
predicted axis-aligned box and a ground-truth box. Only the dataset's own boxes are used as ground truth.
"""
import argparse
import glob
import json
import math
import os
import time

import cv2
import numpy as np
from ultralytics import YOLO

ap = argparse.ArgumentParser()
ap.add_argument("dataset")
ap.add_argument("out")
ap.add_argument("--model", default="seg", choices=["seg", "obb"])
ap.add_argument("--imgsz", type=int, default=1024)
args = ap.parse_args()

here = os.path.dirname(os.path.abspath(__file__))
model = YOLO(os.path.join(here, f"yolov8l-1024-{args.model}.pt"))
CUT = [k for k, v in model.names.items() if v == "cut"][0]

imgs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(args.dataset, "annotated_dataset", "images", "*", "*"))}
labs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(args.dataset, "annotated_dataset", "labels", "*", "*.txt"))}
keys = sorted(k for k in imgs if k in labs)


def read_gt(path, W, H):
    out = []
    for line in open(path):
        q = line.split()
        if len(q) >= 5:
            _, cx, cy, w, h = map(float, q[:5])
            out.append([cx * W - w * W / 2, cy * H - h * H / 2, cx * W + w * W / 2, cy * H + h * H / 2])
    return out


def iou(a, b):
    ix, iy = max(0, min(a[2], b[2]) - max(a[0], b[0])), max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


cache = []
t0 = time.time()
for n, k in enumerate(keys):
    im = cv2.imread(imgs[k])
    H, W = im.shape[:2]
    t = time.time()
    r = model.predict(im, imgsz=args.imgsz, conf=0.25, verbose=False, device="cpu")[0]
    dets = []
    for j in range(len(r.boxes)):
        if int(r.boxes.cls[j]) != CUT:
            continue
        x0, y0, x1, y1 = r.boxes.xyxy[j].tolist()
        d = dict(box=[x0, y0, x1, y1], conf=float(r.boxes.conf[j]))
        if r.masks is not None:
            d["area"] = float(r.masks.data[j].sum()) * (W * H) / float(r.masks.data[j].numel())  # mask area in original pixels
        dets.append(d)
    cache.append(dict(image=k, W=W, H=H, gt=read_gt(labs[k], W, H), dets=dets, sec=time.time() - t))
    if n % 20 == 0:
        print(n, "/", len(keys), f"{time.time() - t0:.0f}s", flush=True)


def evaluate(thr):
    tp = fp = fn = 0
    ious, ratios = [], []
    for c in cache:
        pb = [d for d in c["dets"] if d["conf"] >= thr]
        gt = c["gt"]
        pairs = sorted(((iou(pb[i]["box"], gt[j]), i, j) for i in range(len(pb)) for j in range(len(gt))), reverse=True)
        ui, uj = set(), set()
        for v, i, j in pairs:
            if v < 0.5:
                break
            if i in ui or j in uj:
                continue
            ui.add(i); uj.add(j); ious.append(v)
            g = gt[j]
            if "area" in pb[i]:
                ratios.append(2 * math.sqrt(pb[i]["area"] / math.pi) / (((g[2] - g[0]) + (g[3] - g[1])) / 2))
        tp += len(ui); fp += len(pb) - len(ui); fn += len(gt) - len(uj)
    P, R = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return dict(conf=thr, tp=tp, fp=fp, fn=fn, precision=round(100 * P, 1), recall=round(100 * R, 1), f1=round(200 * P * R / max(P + R, 1e-9), 1),
                mean_iou=round(100 * float(np.mean(ious)), 1) if ious else None,
                diameter_ratio_median=round(float(np.median(ratios)), 3) if ratios else None)


sweep = [evaluate(t) for t in (0.25, 0.4, 0.5, 0.6, 0.7, 0.8)]
for s in sweep:
    print(s)
json.dump(dict(model=f"yolov8l-1024-{args.model}", images=len(cache), gt_boxes=sum(len(c["gt"]) for c in cache), sweep=sweep,
               sec_per_image=round(float(np.mean([c["sec"] for c in cache])), 2), per_image=[dict(image=c["image"], gt=len(c["gt"]), det40=sum(d["conf"] >= 0.4 for d in c["dets"])) for c in cache]),
          open(args.out, "w"), indent=1)
