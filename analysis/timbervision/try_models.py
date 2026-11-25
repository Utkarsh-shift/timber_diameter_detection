"""Quick look at the TimberVision models: classes + detections on a few images.
  analysis/.venv-tv/Scripts/python analysis/timbervision/try_models.py <out_dir> <image> [<image> ...]
"""
import os
import sys
import time

import cv2
from ultralytics import YOLO

here = os.path.dirname(os.path.abspath(__file__))
seg = YOLO(os.path.join(here, "yolov8l-1024-seg.pt"))
obb = YOLO(os.path.join(here, "yolov8l-1024-obb.pt"))
print("seg classes:", seg.names)
print("obb classes:", obb.names)
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
for path in sys.argv[2:]:
    im = cv2.imread(path)
    t = time.time()
    r = seg.predict(im, imgsz=1024, conf=0.25, verbose=False, device="cpu")[0]
    dt = time.time() - t
    counts = {}
    for c in r.boxes.cls.tolist():
        counts[seg.names[int(c)]] = counts.get(seg.names[int(c)], 0) + 1
    print(os.path.basename(path), im.shape[:2], f"{dt:.1f}s", counts)
    cv2.imwrite(os.path.join(out, os.path.splitext(os.path.basename(path))[0] + "_tv.jpg"), r.plot(line_width=2, font_size=10))
