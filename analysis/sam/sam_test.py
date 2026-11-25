"""Test SAM 2.1 on log-end photos, two ways, and draw the results next to the TimberVision pre-labels.

  A. "everything" mode: SAM segments the whole photo from a grid of points; masks are kept only when they look like a
     log end (size, roundness, solidity) and duplicates are removed.
  B. box-prompted mode: every TimberVision box (from prelabels/annotations.xml) is given to SAM, which redraws the outline.

Run with the SAM environment:
  analysis/.venv-sam/Scripts/python analysis/sam/sam_test.py <photo_dir> <prelabel_xml> <out_dir> [model] [points_stride] [photo names...]
"""
import functools
import json
import os
import sys
import time
import xml.etree.ElementTree as ET

import cv2
import numpy as np
from ultralytics import SAM

src, xml_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
model_name = sys.argv[4] if len(sys.argv) > 4 else "sam2.1_b.pt"
stride = int(sys.argv[5]) if len(sys.argv) > 5 else 32
only = sys.argv[6:]
os.makedirs(out, exist_ok=True)

# TimberVision pre-labels: polygons per photo
tv = {}
for im in ET.parse(xml_path).getroot().findall("image"):
    tv[im.get("name")] = [np.array([[float(v) for v in p.split(",")] for p in pg.get("points").split(";")], np.float32) for pg in im.findall("polygon")]

model = SAM(os.path.join(os.path.dirname(os.path.abspath(__file__)), model_name))
model.predict(np.zeros((64, 64, 3), np.uint8), bboxes=[[0, 0, 10, 10]], verbose=False)  # creates the predictor
pred = model.predictor
pred.generate = functools.partial(pred.generate, points_stride=stride, points_batch_size=128, conf_thres=0.8, stability_score_thresh=0.9)


def to_u8(m):
    return (m.cpu().numpy() > 0.5).astype(np.uint8) if hasattr(m, "cpu") else (m > 0.5).astype(np.uint8)


def log_like(mask, img_area):
    """Shape test for one mask: returns (keep, contour)."""
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs:
        return False, None
    c = max(cs, key=cv2.contourArea)
    a = cv2.contourArea(c)
    if a < 120 or a > 0.04 * img_area or len(c) < 5:
        return False, c
    hull = cv2.contourArea(cv2.convexHull(c))
    (_, _), (d1, d2), _ = cv2.fitEllipse(c)
    if hull <= 0 or min(d1, d2) <= 0:
        return False, c
    solidity = a / hull
    ratio = max(d1, d2) / min(d1, d2)
    fill = a / (np.pi * d1 * d2 / 4)
    return (solidity > 0.88 and ratio < 2.2 and 0.7 < fill < 1.2), c


def dedupe(items):
    """Drop masks that mostly overlap a kept one (keep larger score first)."""
    kept = []
    for s, m, c in sorted(items, key=lambda t: -t[0]):
        a = m.sum()
        if all((m & k[1]).sum() < 0.5 * min(a, k[1].sum()) for k in kept):
            kept.append((s, m, c))
    return kept


def draw(img, contours, color, label):
    o = img.copy()
    th = max(2, img.shape[1] // 600)
    cv2.drawContours(o, [c.astype(np.int32).reshape(-1, 1, 2) for c in contours], -1, color, th, cv2.LINE_AA)
    cv2.rectangle(o, (0, 0), (o.shape[1], 44), (23, 63, 53), -1)
    cv2.putText(o, label, (10, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2, cv2.LINE_AA)
    return o


def simplify(c):
    c = c.astype(np.float32).reshape(-1, 1, 2)
    return cv2.approxPolyDP(c, max(1.0, 0.004 * cv2.arcLength(c, True)), True).reshape(-1, 2)


def write_cvat(path, done, key):
    """CVAT for images 1.1 file with one log_end polygon per outline (import: task -> Upload annotations -> CVAT 1.1)."""
    from xml.sax.saxutils import quoteattr
    lines = ['<?xml version="1.0" encoding="utf-8"?>', "<annotations>", "  <version>1.1</version>"]
    for i, name in enumerate(sorted(done)):
        d = done[name]
        lines.append(f'  <image id="{i}" name={quoteattr(name)} width="{d["w"]}" height="{d["h"]}">')
        for poly in d[key]:
            pts = ";".join(f"{x:.2f},{y:.2f}" for x, y in poly)
            lines.append(f'    <polygon label="log_end" source="manual" occluded="0" points="{pts}" z_order="0"><attribute name="partly_hidden">false</attribute></polygon>')
        lines.append("  </image>")
    lines.append("</annotations>")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# per-photo results are saved as they finish, so a stopped run resumes where it left off
poly_dir = os.path.join(out, "polygons")
os.makedirs(poly_dir, exist_ok=True)
done = {}
for f in os.listdir(poly_dir):
    with open(os.path.join(poly_dir, f)) as fh:
        d = json.load(fh)
    done[d["photo"]] = d

names = only or sorted(tv)
summary = [done[n]["row"] for n in names if n in done]
t_start = time.time()
for k, name in enumerate(names):
    if name in done:
        continue
    img = cv2.imdecode(np.fromfile(os.path.join(src, name), np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    stem = os.path.splitext(name)[0]

    # A. everything mode
    t0 = time.time()
    r = model.predict(img, verbose=False)[0]
    ta = time.time() - t0
    raw = r.masks.data if r.masks is not None else []
    cand = []
    for i in range(len(raw)):
        m = to_u8(raw[i])
        ok, c = log_like(m, h * w)
        if ok:
            cand.append((float(r.boxes.conf[i]) if r.boxes is not None else 1.0, m.astype(bool), c))
    every = dedupe(cand)

    # B. box-prompted from TimberVision
    tv_polys = tv.get(name, [])
    boxed, iou = [], []
    t0 = time.time()
    if tv_polys:
        boxes = [[p[:, 0].min(), p[:, 1].min(), p[:, 0].max(), p[:, 1].max()] for p in tv_polys]
        rb = model.predict(img, bboxes=boxes, verbose=False)[0]
        for i in range(len(rb.masks.data)):
            m = to_u8(rb.masks.data[i])
            cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not cs:
                continue
            boxed.append(max(cs, key=cv2.contourArea))
            t = np.zeros((h, w), np.uint8)
            cv2.fillPoly(t, [tv_polys[i].astype(np.int32)], 1)
            inter, uni = (m & t).sum(), (m | t).sum()
            iou.append(inter / uni if uni else 0)
    tb = time.time() - t0

    row = dict(photo=name, sam_raw_masks=len(raw), sam_everything=len(every), timbervision=len(tv_polys),
               sam_boxed=len(boxed), mean_iou_sam_vs_tv=round(float(np.mean(iou)), 3) if iou else None,
               sec_everything=round(ta, 1), sec_boxed=round(tb, 1))
    summary.append(row)
    print(f"[{k + 1}/{len(names)} {time.time() - t_start:.0f}s] " + json.dumps(row), flush=True)
    rec = dict(photo=name, w=w, h=h, row=row,
               everything=[simplify(c).round(2).tolist() for _, _, c in every],
               boxed=[simplify(c).round(2).tolist() for c in boxed])
    with open(os.path.join(poly_dir, stem + ".json"), "w") as fh:
        json.dump(rec, fh)
    done[name] = rec

    panels = [draw(img, tv_polys, (60, 220, 60), f"TimberVision: {len(tv_polys)} logs"),
              draw(img, [c for _, _, c in every], (230, 160, 40), f"SAM 2.1 everything: {len(every)} logs"),
              draw(img, boxed, (60, 200, 230), f"SAM 2.1 on TimberVision boxes: {len(boxed)}")]
    sheet = np.hstack(panels)
    s = min(1.0, 2400 / sheet.shape[1])
    cv2.imwrite(os.path.join(out, f"{stem}.jpg"), cv2.resize(sheet, None, fx=s, fy=s), [cv2.IMWRITE_JPEG_QUALITY, 85])

with open(os.path.join(out, "summary.json"), "w") as f:
    json.dump(summary, f, indent=1)
write_cvat(os.path.join(out, "sam_everything_cvat.xml"), done, "everything")
write_cvat(os.path.join(out, "sam_on_timbervision_boxes_cvat.xml"), done, "boxed")
print(f"done: {len(done)} photos; CVAT files written to {out}", flush=True)
