"""Pre-label a folder of photos with TimberVision and write a CVAT 'CVAT for images 1.1' annotation file.

Run with the TimberVision environment (needs torch + ultralytics):
  analysis/.venv-tv/Scripts/python analysis/timbervision/prelabel.py <photo_dir> <out_dir> [conf]

Writes <out_dir>/annotations.xml (import it in CVAT: task -> Actions -> Upload annotations -> "CVAT 1.1")
and <out_dir>/preview/<photo>.jpg (outlines drawn on each photo, to check the result quickly).
Every polygon is the model's log-end mask (class 'cut'), simplified to a few dozen points so it stays easy to edit in CVAT.
Labels used: log_end (polygon) with the attribute partly_hidden=false.
"""
import os
import sys
import time
from xml.sax.saxutils import quoteattr

import cv2
import numpy as np
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
src, out = sys.argv[1], sys.argv[2]
conf = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
os.makedirs(os.path.join(out, "preview"), exist_ok=True)

model = YOLO(os.path.join(HERE, "yolov8l-1024-seg.pt"))
cut = [k for k, v in model.names.items() if v == "cut"][0]
names = sorted(f for f in os.listdir(src) if f.lower().endswith((".jpg", ".jpeg", ".png")))

xml = ['<?xml version="1.0" encoding="utf-8"?>', "<annotations>", "  <version>1.1</version>"]
total = 0
t0 = time.time()
for i, name in enumerate(names):
    im = cv2.imdecode(np.fromfile(os.path.join(src, name), np.uint8), cv2.IMREAD_COLOR)  # honours EXIF orientation like CVAT
    h, w = im.shape[:2]
    r = model.predict(im, imgsz=1024, conf=conf, verbose=False, device="cpu")[0]
    polys = []
    if r.masks is not None:
        for j in range(len(r.boxes)):
            if int(r.boxes.cls[j]) != cut:
                continue
            pts = r.masks.xy[j]
            if pts is None or len(pts) < 5:
                continue
            c = pts.astype(np.float32).reshape(-1, 1, 2)
            c = cv2.approxPolyDP(c, max(1.0, 0.004 * cv2.arcLength(c, True)), True).reshape(-1, 2)
            if len(c) >= 3:
                polys.append(c)
    xml.append(f"  <image id={quoteattr(str(i))} name={quoteattr(name)} width=\"{w}\" height=\"{h}\">")
    prev = im.copy()
    for c in polys:
        pts = ";".join(f"{x:.2f},{y:.2f}" for x, y in c)
        xml.append(f'    <polygon label="log_end" source="manual" occluded="0" points="{pts}" z_order="0"><attribute name="partly_hidden">false</attribute></polygon>')
        cv2.polylines(prev, [c.astype(np.int32)], True, (60, 220, 60), max(2, w // 600), cv2.LINE_AA)
    xml.append("  </image>")
    cv2.imwrite(os.path.join(out, "preview", os.path.splitext(name)[0] + ".jpg"), prev, [cv2.IMWRITE_JPEG_QUALITY, 80])
    total += len(polys)
    print(f"{i + 1}/{len(names)} {name}: {len(polys)} logs  ({time.time() - t0:.0f}s)", flush=True)
xml.append("</annotations>")
with open(os.path.join(out, "annotations.xml"), "w", encoding="utf-8") as f:
    f.write("\n".join(xml))
print(f"done: {total} polygons in {len(names)} photos -> {os.path.join(out, 'annotations.xml')}")
