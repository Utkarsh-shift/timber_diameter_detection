"""Redraw rough polygons on the original photo with SAM 2.1 (box prompt per polygon) and keep only the ones where
SAM and the rough outline agree.

  analysis/.venv-sam/Scripts/python analysis/sam/refine_polygons.py <polygons.json> <photo> <out_dir> [min_iou]

<polygons.json> is what analysis/extract_green_polygons.py writes. Outputs <photo>_sam.txt (YOLO segmentation,
class 0 = log end), <photo>_sam_cvat.xml (CVAT 1.1, label log_end) and <photo>_sam_check.jpg
(red = rough outline, green = SAM outline that was kept).
"""
import json
import os
import sys
from xml.sax.saxutils import quoteattr

import cv2
import numpy as np
from ultralytics import SAM

poly_path, photo, out = sys.argv[1], sys.argv[2], sys.argv[3]
min_iou = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
os.makedirs(out, exist_ok=True)
src = json.load(open(poly_path))
img = cv2.imdecode(np.fromfile(photo, np.uint8), cv2.IMREAD_COLOR)
H, W = img.shape[:2]
rough = [np.array(p, np.float32) for p in src["polygons"]]

boxes = []
for p in rough:  # box around the rough outline, 10 % larger so SAM sees the whole log end
    x0, y0, x1, y1 = p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()
    mx, my = 0.1 * (x1 - x0) + 2, 0.1 * (y1 - y0) + 2
    boxes.append([max(0, x0 - mx), max(0, y0 - my), min(W - 1, x1 + mx), min(H - 1, y1 + my)])

model = SAM(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sam2.1_b.pt"))
res = model.predict(img, bboxes=boxes, verbose=False)[0]
kept, ious = [], []
for i, p in enumerate(rough):
    m = (res.masks.data[i].cpu().numpy() > 0.5).astype(np.uint8)
    t = np.zeros((H, W), np.uint8)
    cv2.fillPoly(t, [p.astype(np.int32)], 1)
    uni = (m | t).sum()
    iou = (m & t).sum() / uni if uni else 0.0
    ious.append(iou)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    # rough outlines extracted from drawn lines sit slightly inside the log end, so plain IoU under-rates small logs:
    # accept when SAM's mask covers the rough outline and is not much larger (no spill onto neighbouring logs)
    covers = (m & t).sum() / max(1, t.sum())
    grown = m.sum() / max(1, t.sum())
    if not cs or not (iou >= min_iou or (covers >= 0.8 and grown <= 3.0)):
        continue
    c = max(cs, key=cv2.contourArea).astype(np.float32)
    c = cv2.approxPolyDP(c, max(1.0, 0.004 * cv2.arcLength(c, True)), True).reshape(-1, 2)
    if len(c) >= 3:
        kept.append(c)

ious = np.array(ious)
print(f"{len(rough)} rough outlines -> {len(kept)} kept (SAM agrees, IoU >= {min_iou}); median IoU {np.median(ious):.2f}; "
      f"IoU < 0.3: {(ious < 0.3).sum()}, 0.3-{min_iou}: {((ious >= 0.3) & (ious < min_iou)).sum()}")

stem = os.path.splitext(os.path.basename(photo))[0]
with open(os.path.join(out, stem + "_sam.txt"), "w") as f:
    for p in kept:
        f.write("0 " + " ".join(f"{x / W:.6f} {y / H:.6f}" for x, y in p) + "\n")
xml = ['<?xml version="1.0" encoding="utf-8"?>', "<annotations>", "  <version>1.1</version>",
       f'  <image id="0" name={quoteattr(os.path.basename(photo))} width="{W}" height="{H}">']
for p in kept:
    xml.append('    <polygon label="log_end" source="manual" occluded="0" points="' + ";".join(f"{x:.2f},{y:.2f}" for x, y in p)
               + '" z_order="0"><attribute name="partly_hidden">false</attribute></polygon>')
xml += ["  </image>", "</annotations>"]
with open(os.path.join(out, stem + "_sam_cvat.xml"), "w", encoding="utf-8") as f:
    f.write("\n".join(xml))
chk = img.copy()
cv2.polylines(chk, [p.astype(np.int32) for p in rough], True, (40, 40, 230), 1, cv2.LINE_AA)
cv2.polylines(chk, [p.astype(np.int32) for p in kept], True, (60, 220, 60), 2, cv2.LINE_AA)
cv2.imwrite(os.path.join(out, stem + "_sam_check.jpg"), chk, [cv2.IMWRITE_JPEG_QUALITY, 90])
