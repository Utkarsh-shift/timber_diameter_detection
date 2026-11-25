"""Evaluate the detector on the bundled sample pile (regenerated with the same parameters, so ground truth is known).
Usage: python eval_sample.py [profile] [out.jpg]"""
import math
import sys

import cv2
import numpy as np

from detect import PROFILES, annotate, detect
from synth import make_pile

profile = sys.argv[1] if len(sys.argv) > 1 else "ellipse-v1.3-highrecall"
img, truth, ppm = make_pile(w=2400, h=1250, mean_mm=125, sd_mm=13, px_per_mm=0.915, seed=7)
logs = detect(img, PROFILES[profile])
used, errs, extra = set(), [], []
for L in logs:
    cand = [(math.hypot(L.cx - t["cx"], L.cy - t["cy"]), j) for j, t in enumerate(truth) if j not in used]
    d, j = min(cand) if cand else (1e9, None)
    if j is not None and d < 0.5 * truth[j]["a"]:
        used.add(j)
        errs.append(2 * math.sqrt(L.a * L.b) / ppm - truth[j]["eq_mm"])
    else:
        extra.append(L)
errs = np.array(errs)
print(f"truth={len(truth)} detected={len(logs)} matched={len(used)} extra={len(extra)} missed={len(truth) - len(used)}")
print(f"matched diameter error mm: mean={errs.mean():+.2f} MAE={np.abs(errs).mean():.2f} max={np.abs(errs).max():.1f}")
print("extra detections (diam mm):", sorted(round(2 * math.sqrt(L.a * L.b) / ppm) for L in extra))
if len(sys.argv) > 2:
    cv2.imwrite(sys.argv[2], annotate(img, logs, {i for i, L in enumerate(logs) if L in extra}))
