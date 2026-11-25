"""Validation against synthetic ground truth: python selftest.py"""
import math
import numpy as np
from detect import Params, detect
from synth import make_checkerboards, make_pile
import calib

img, truth, ppm = make_pile()
logs = detect(img)
used = set(); rows = []
for L in logs:
    best = min(((math.hypot(L.cx - t["cx"], L.cy - t["cy"]), j) for j, t in enumerate(truth) if j not in used), default=None)
    if best and best[0] < 0.5 * truth[best[1]]["a"]:
        used.add(best[1]); rows.append((L, truth[best[1]]))
print(f"detection: {len(rows)}/{len(truth)} matched, {len(logs) - len(rows)} extra")
for name, key, thr in (("crack", "crack_pct", 30.0), ("rot", "rot_pct", 8.0)):
    tp = fp = fn = 0
    for L, t in rows:
        v = L.extra.get(key.replace("_pct", ""))
        pred = v is not None and v >= thr
        tp += pred and t[name]; fp += pred and not t[name]; fn += (not pred) and t[name]
    print(f"{name}: truth={sum(t[name] for _, t in rows)} tp={tp} fp={fp} fn={fn}  precision={tp/max(1,tp+fp):.2f} recall={tp/max(1,tp+fn):.2f}")

imgs, fx = make_checkerboards()
r = calib.calibrate(imgs, 9, 6, 40.0)
print(f"calibration: used {r['used']}/{r['total']} fx={r['K']['fx']:.1f} (true {fx}) rms={r['rms']:.3f}px mm/px={r['mm_per_px']:.4f}")
