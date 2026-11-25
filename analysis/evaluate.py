"""Run the detector on the synthetic pile (with ground truth) and on any images given on the command line."""
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from detect import Params, annotate, detect
from synth import make_pile

OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("eval_out")
OUT.mkdir(exist_ok=True, parents=True)


def match(logs, truth, ppm):
    used, errs, tp = set(), [], 0
    for L in logs:
        best, bd = None, 1e9
        for j, t in enumerate(truth):
            d = math.hypot(L.cx - t["cx"], L.cy - t["cy"])
            if d < bd and j not in used:
                best, bd = j, d
        if best is not None and bd < 0.5 * truth[best]["a"]:
            used.add(best)
            tp += 1
            eq_mm = 2 * math.sqrt(L.a * L.b) / ppm
            errs.append(eq_mm - truth[best]["eq_mm"])
    return tp, np.array(errs), used


img, truth, ppm = make_pile()
cv2.imwrite(str(OUT / "synthetic.jpg"), img)
t = time.time()
logs = detect(img)
dt = time.time() - t
tp, errs, used = match(logs, truth, ppm)
print(f"synthetic: truth={len(truth)} detected={len(logs)} matched={tp}  recall={tp/len(truth):.2f} precision={tp/max(1,len(logs)):.2f}  time={dt:.2f}s")
if len(errs):
    print(f"  diameter error mm: mean={errs.mean():+.2f} MAE={np.abs(errs).mean():.2f} p95={np.percentile(np.abs(errs),95):.2f}")
cv2.imwrite(str(OUT / "synthetic_annot.jpg"), annotate(img, logs, set()))

for f in sys.argv[2:]:
    im = cv2.imread(f)
    t = time.time()
    lg = detect(im)
    print(f"{Path(f).name}: {im.shape[1]}x{im.shape[0]} detected={len(lg)} time={time.time()-t:.2f}s")
    cv2.imwrite(str(OUT / (Path(f).stem + "_annot.jpg")), annotate(im, lg, set()))
