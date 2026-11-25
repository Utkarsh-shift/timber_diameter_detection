"""TimberVision worker: runs the YOLOv8 segmentation model and returns one ellipse per log end face ('cut' class).

Runs in its own virtualenv (analysis/.venv-tv: torch 2.3 + ultralytics 8.2.22 + numpy<2).
  analysis/.venv-tv/Scripts/python -m uvicorn worker:app --port 5001      (from analysis/timbervision)

Models: https://github.com/timbervision/timbervision (v1.0.0 release). Licence CC BY-NC-SA 4.0 (non-commercial); ultralytics is AGPL-3.0.
"""
import os
import time

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from ultralytics import YOLO

HERE = os.path.dirname(os.path.abspath(__file__))
app = FastAPI(title="TimberVision worker")
_model = None


def model():
    global _model
    if _model is None:
        path = os.path.join(HERE, "yolov8l-1024-seg.pt")
        if not os.path.exists(path):
            raise HTTPException(503, "yolov8l-1024-seg.pt is missing; see analysis/timbervision/README.md")
        _model = YOLO(path)
    return _model


@app.get("/health")
def health():
    return dict(ok=True, model_present=os.path.exists(os.path.join(HERE, "yolov8l-1024-seg.pt")))


@app.post("/detect")
async def detect(file: UploadFile = File(...), conf: float = Form(0.4), imgsz: int = Form(1024)):
    im = cv2.imdecode(np.frombuffer(await file.read(), np.uint8), cv2.IMREAD_COLOR)
    if im is None:
        raise HTTPException(400, "Could not decode image")
    m = model()
    cut = [k for k, v in m.names.items() if v == "cut"][0]
    t = time.time()
    r = m.predict(im, imgsz=imgsz, conf=conf, verbose=False, device="cpu")[0]
    out = []
    if r.masks is not None:
        for j in range(len(r.boxes)):
            if int(r.boxes.cls[j]) != cut:
                continue
            pts = r.masks.xy[j]
            if pts is None or len(pts) < 5:
                continue
            (cx, cy), (d1, d2), ang = cv2.fitEllipse(pts.astype(np.float32).reshape(-1, 1, 2))
            if d1 < d2:
                d1, d2, ang = d2, d1, ang + 90
            out.append(dict(cx=float(cx), cy=float(cy), a=float(d1 / 2), b=float(d2 / 2), angle=float(ang % 180), conf=float(r.boxes.conf[j]),
                            area=float(cv2.contourArea(pts.astype(np.float32)))))
    return dict(ellipses=out, ms=round((time.time() - t) * 1000), height=im.shape[0], width=im.shape[1])
