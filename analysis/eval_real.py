"""Evaluate the detector on the real DIIF log-end dataset (YOLO boxes = ground truth).

Run with the analysis venv:
  analysis/.venv/Scripts/python analysis/eval_real.py <dataset_dir> [--profile NAME] [--out DIR] [--max N]

<dataset_dir> must contain annotated_dataset/{images,labels}/<split>/ (see backend/data/uploads/diif_logend).
Matching: greedy by IoU between the detection's axis-aligned bounding box and a ground-truth box, IoU >= 0.5.
Diameter check (scale free): GT diameter = mean(box w, box h) in px vs the fitted equivalent diameter 2*sqrt(a*b) in px.
"""
import argparse
import glob
import json
import math
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from detect import PROFILES, detect  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("dataset")
ap.add_argument("--profile", default="ellipse-v1.3-highrecall")
ap.add_argument("--out", default=None)
ap.add_argument("--max", type=int, default=0)
ap.add_argument("--json", default=None)
ap.add_argument("--workers", type=int, default=8)
args = ap.parse_args()


def read_gt(path, W, H):
    boxes = []
    for line in open(path):
        p = line.split()
        if len(p) < 5:
            continue
        _, cx, cy, w, h = map(float, p[:5])
        boxes.append((cx * W - w * W / 2, cy * H - h * H / 2, cx * W + w * W / 2, cy * H + h * H / 2))
    return boxes


def ell_box(L):
    t = math.radians(L.angle)
    hw = math.sqrt((L.a * math.cos(t)) ** 2 + (L.b * math.sin(t)) ** 2)
    hh = math.sqrt((L.a * math.sin(t)) ** 2 + (L.b * math.cos(t)) ** 2)
    return (L.cx - hw, L.cy - hh, L.cx + hw, L.cy + hh)


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0


imgs = {}
for p in glob.glob(os.path.join(args.dataset, "annotated_dataset", "images", "*", "*")):
    imgs[os.path.splitext(os.path.basename(p))[0]] = p
labs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(args.dataset, "annotated_dataset", "labels", "*", "*.txt"))}
keys = sorted(k for k in imgs if k in labs)
if args.max:
    keys = keys[: args.max]
if args.out:
    os.makedirs(args.out, exist_ok=True)

def work(k):
    im = cv2.imread(imgs[k])
    if im is None:
        return None
    H, W = im.shape[:2]
    gt = read_gt(labs[k], W, H)
    logs = detect(im, PROFILES[args.profile])
    pb = [ell_box(L) for L in logs]
    pairs = sorted(((iou(pb[i], gt[j]), i, j) for i in range(len(pb)) for j in range(len(gt))), reverse=True)
    ui, uj, matched = set(), set(), []
    for v, i, j in pairs:
        if v < 0.5:
            break
        if i in ui or j in uj:
            continue
        ui.add(i); uj.add(j); matched.append((i, j, v))
    ious_k = [v for _, _, v in matched]
    dr_k = [(2 * math.sqrt(logs[i].a * logs[i].b)) / (((gt[j][2] - gt[j][0]) + (gt[j][3] - gt[j][1])) / 2) for i, j, _ in matched]
    if args.out:
        vis = im.copy(); t = max(1, W // 700)
        for g in gt:
            cv2.rectangle(vis, (int(g[0]), int(g[1])), (int(g[2]), int(g[3])), (0, 200, 255), t)
        for L in logs:
            cv2.ellipse(vis, ((L.cx, L.cy), (2 * L.a, 2 * L.b), L.angle), (80, 200, 80), t + 1, cv2.LINE_AA)
        s = 900 / max(W, H)
        cv2.imwrite(os.path.join(args.out, k + ".jpg"), cv2.resize(vis, (int(W * s), int(H * s))))
    return dict(image=k, w=W, h=H, gt=len(gt), det=len(pb), tp=len(matched), fp=len(pb) - len(matched), fn=len(gt) - len(matched)), ious_k, dr_k


if __name__ == "__main__":
    from concurrent.futures import ProcessPoolExecutor
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        results = [r for r in ex.map(work, keys) if r]
    rows = [r[0] for r in results]
    ious = [v for r in results for v in r[1]]
    dratio = [v for r in results for v in r[2]]
    tot = dict(tp=sum(r["tp"] for r in rows), fp=sum(r["fp"] for r in rows), fn=sum(r["fn"] for r in rows))
    P = tot["tp"] / max(1, tot["tp"] + tot["fp"]); R = tot["tp"] / max(1, tot["tp"] + tot["fn"])
    summary = dict(profile=args.profile, images=len(rows), gt_boxes=tot["tp"] + tot["fn"], detections=tot["tp"] + tot["fp"], **tot,
                   precision=round(100 * P, 1), recall=round(100 * R, 1), f1=round(200 * P * R / max(P + R, 1e-9), 1),
                   mean_iou=round(100 * float(np.mean(ious)), 1) if ious else None,
                   diameter_ratio_median=round(float(np.median(dratio)), 3) if dratio else None,
                   diameter_abs_err_pct=round(100 * float(np.median(np.abs(np.array(dratio) - 1))), 1) if dratio else None)
    print(json.dumps(summary, indent=1))
    worst = sorted(rows, key=lambda r: -(r["fp"] + r["fn"]))[:8]
    print("worst images:", [(r["image"], r["gt"], r["det"], r["tp"]) for r in worst])
    if args.json:
        json.dump(dict(summary=summary, rows=rows), open(args.json, "w"), indent=1)
