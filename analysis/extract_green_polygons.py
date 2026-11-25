"""Turn green outlines drawn on a copy of a photo (e.g. by an image generator) into polygon labels for the original photo.

  analysis/.venv/Scripts/python analysis/extract_green_polygons.py <outlined_image> <original_photo> <out_dir>

Steps: find the green line pixels, measure how the outlined copy is aligned to the original (affine fit on the
photo content, green removed), take every closed green outline as one polygon (the region enclosed by the line,
grown by half the line width), and map it to original-photo pixels.
Writes <out_dir>/<photo>.txt (YOLO segmentation, class 0 = log end), <photo>_cvat.xml (CVAT for images 1.1, label
log_end), <photo>_polygons.json (pixel coordinates) and <photo>_check.jpg (polygons drawn on the original photo).
"""
import json
import os
import sys
from xml.sax.saxutils import quoteattr

import cv2
import numpy as np

gen_path, orig_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
gen = cv2.imdecode(np.fromfile(gen_path, np.uint8), cv2.IMREAD_COLOR)
orig = cv2.imdecode(np.fromfile(orig_path, np.uint8), cv2.IMREAD_COLOR)
gh, gw = gen.shape[:2]
oh, ow = orig.shape[:2]
name = os.path.basename(orig_path)
stem = os.path.splitext(name)[0]

# 1. green line pixels. Generators often tint the whole picture and draw soft, half-transparent lines, so a line pixel
#    is one that is clearly greener than its immediate surroundings (white top-hat on the "greenness" channel).
b, g, r = [gen[:, :, i].astype(np.float32) for i in range(3)]
greenness = np.clip(g - np.maximum(r, b) + 50, 0, 255).astype(np.uint8)
tophat = cv2.morphologyEx(greenness, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
line = cv2.morphologyEx((tophat > 8).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))  # bridge 1-px breaks

# 2. alignment of the outlined copy to the original (scaled to the copy's size); green pixels are painted over first
clean = cv2.inpaint(gen, cv2.dilate(line, np.ones((3, 3), np.uint8)), 3, cv2.INPAINT_TELEA)
a = cv2.cvtColor(cv2.resize(orig, (gw, gh), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
c = cv2.cvtColor(clean, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
warp = np.eye(2, 3, dtype=np.float32)
try:
    cc, warp = cv2.findTransformECC(a, c, warp, cv2.MOTION_AFFINE, (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 200, 1e-6), None, 5)
except cv2.error:
    cc = None
inv = cv2.invertAffineTransform(warp)  # copy pixels -> resized-original pixels
print(f"alignment: correlation {cc:.4f}" if cc else "alignment: ECC failed, assuming no shift",
      f"| shift {warp[0, 2]:+.2f},{warp[1, 2]:+.2f} px, scale {warp[0, 0]:.4f}/{warp[1, 1]:.4f} (in {gw}x{gh} copy pixels)")

# 3. closed outlines = regions fully enclosed by green line
n, lab, stats, _ = cv2.connectedComponentsWithStats((1 - line).astype(np.uint8), connectivity=4)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
sx, sy = ow / gw, oh / gh
polys, skipped = [], dict(too_small=0, too_large=0, not_compact=0)
for i in range(1, n):
    if i in border:
        continue
    area = stats[i, cv2.CC_STAT_AREA]
    if area < 8:
        skipped["too_small"] += 1
        continue
    if area > 0.02 * gw * gh:
        skipped["too_large"] += 1
        continue
    m = cv2.dilate((lab == i).astype(np.uint8), np.ones((3, 3), np.uint8))  # grow onto the middle of the drawn line
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cnt = max(cs, key=cv2.contourArea).reshape(-1, 2).astype(np.float32)
    # touching outlines with gaps merge into jagged multi-log shapes: keep only compact, log-like regions
    hull = cv2.contourArea(cv2.convexHull(cnt))
    if hull <= 0 or cv2.contourArea(cnt) / hull < 0.82:
        skipped["not_compact"] += 1
        continue
    cnt = cv2.approxPolyDP(cnt.reshape(-1, 1, 2), 0.6, True).reshape(-1, 2)
    if len(cnt) < 3:
        continue
    pts = np.hstack([cnt, np.ones((len(cnt), 1), np.float32)]) @ inv.T  # undo the copy's shift / scale
    pts[:, 0] = np.clip(pts[:, 0] * sx, 0, ow - 1)
    pts[:, 1] = np.clip(pts[:, 1] * sy, 0, oh - 1)
    polys.append(pts)

# open (unclosed) outlines are not usable as polygons; count them for the report
open_pieces = cv2.connectedComponents(line)[0] - 1
print(f"{len(polys)} closed polygons | skipped {skipped} | green line pieces in total {open_pieces}")

# 4. outputs
with open(os.path.join(out, stem + ".txt"), "w") as f:
    for p in polys:
        f.write("0 " + " ".join(f"{x / ow:.6f} {y / oh:.6f}" for x, y in p) + "\n")
with open(os.path.join(out, stem + "_polygons.json"), "w") as f:
    json.dump(dict(photo=name, width=ow, height=oh, label="log_end", polygons=[p.round(1).tolist() for p in polys]), f)
xml = ['<?xml version="1.0" encoding="utf-8"?>', "<annotations>", "  <version>1.1</version>",
       f'  <image id="0" name={quoteattr(name)} width="{ow}" height="{oh}">']
for p in polys:
    xml.append('    <polygon label="log_end" source="manual" occluded="0" points="' + ";".join(f"{x:.2f},{y:.2f}" for x, y in p)
               + '" z_order="0"><attribute name="partly_hidden">false</attribute></polygon>')
xml += ["  </image>", "</annotations>"]
with open(os.path.join(out, stem + "_cvat.xml"), "w", encoding="utf-8") as f:
    f.write("\n".join(xml))
chk = orig.copy()
cv2.polylines(chk, [p.astype(np.int32) for p in polys], True, (40, 40, 240), 2, cv2.LINE_AA)
cv2.imwrite(os.path.join(out, stem + "_check.jpg"), chk, [cv2.IMWRITE_JPEG_QUALITY, 90])
