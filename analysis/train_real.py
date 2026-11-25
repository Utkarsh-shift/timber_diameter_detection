"""Train the log-end candidate verifier on the real DIIF dataset and report honest, held-out accuracy.

  analysis/.venv/Scripts/python analysis/train_real.py <dataset_dir> [--out analysis/models] [--workers 8]

1. Generate every plausible ellipse (Hough + distance-transform seeds, ray-fitted) for each image, with 20 features.
2. Label a candidate positive if its bounding box has IoU >= 0.5 with a ground-truth box, negative if IoU < 0.3 with all of them.
3. Grouped 5-fold cross-validation (consecutive photo numbers are kept in one fold to limit scene leakage); the end-to-end
   metric is computed on held-out images only: threshold -> area-overlap NMS -> match to ground truth (IoU >= 0.5).
4. Fit the final model on everything and save it with its metadata.
"""
import argparse
import glob
import json
import math
import os
import re
import sys
import time

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import detect as D  # noqa: E402


def read_gt(path, W, H):
    out = []
    for line in open(path):
        q = line.split()
        if len(q) >= 5:
            _, cx, cy, w, h = map(float, q[:5])
            out.append((cx * W - w * W / 2, cy * H - h * H / 2, cx * W + w * W / 2, cy * H + h * H / 2))
    return out


def ell_box(c, s):
    ex, ey, a, b, ang = (v / s if i < 4 else v for i, v in enumerate(c[:5]))
    t = math.radians(ang)
    hw, hh = math.sqrt((a * math.cos(t)) ** 2 + (b * math.sin(t)) ** 2), math.sqrt((a * math.sin(t)) ** 2 + (b * math.cos(t)) ** 2)
    return (ex - hw, ey - hh, ex + hw, ey + hh)


def iou(a, b):
    ix, iy = max(0, min(a[2], b[2]) - max(a[0], b[0])), max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def extract(args):
    key, img_path, lab_path = args
    im = cv2.imread(img_path)
    if im is None:
        return None
    H, W = im.shape[:2]
    gt = read_gt(lab_path, W, H)
    s, gen = D.generate(im)
    rows = []
    for c, f in gen:
        bb = ell_box(c, s)
        best = max((iou(bb, g) for g in gt), default=0.0)
        rows.append((np.array(c, dtype=np.float32), f, bb, best))
    return key, W, H, s, gt, rows


def group_of(key):
    m = re.search(r"(\d+)", key)
    return (int(m.group(1)) // 6) if m else hash(key) % 1000


COVER = 0.35


def end_to_end(items, probs, thr):
    """items: per-image dicts; probs: per-image arrays of candidate probabilities."""
    tp = fp = fn = 0
    ious = []
    for it, pr in zip(items, probs):
        keep = [(it["cand"][i], pr[i]) for i in range(len(pr)) if pr[i] >= thr]
        shape = (int(it["H"] * it["s"]) + 2, int(it["W"] * it["s"]) + 2)
        cands = [tuple(c[:5]) + (float(p),) + (1.0,) for c, p in keep]
        kept = D._nms(cands, shape, max_cover=COVER, by_size=True)
        pb = [ell_box(c, it["s"]) for c in kept]
        pairs = sorted(((iou(pb[i], it["gt"][j]), i, j) for i in range(len(pb)) for j in range(len(it["gt"]))), reverse=True)
        ui, uj = set(), set()
        for v, i, j in pairs:
            if v < 0.5:
                break
            if i in ui or j in uj:
                continue
            ui.add(i); uj.add(j); ious.append(v)
        tp += len(ui); fp += len(pb) - len(ui); fn += len(it["gt"]) - len(uj)
    P, R = tp / max(1, tp + fp), tp / max(1, tp + fn)
    return dict(thr=thr, tp=tp, fp=fp, fn=fn, precision=round(100 * P, 1), recall=round(100 * R, 1),
                f1=round(200 * P * R / max(P + R, 1e-9), 1), mean_iou=round(100 * float(np.mean(ious)), 1) if ious else None)


if __name__ == "__main__":
    from concurrent.futures import ProcessPoolExecutor

    from sklearn.ensemble import HistGradientBoostingClassifier
    from sklearn.model_selection import GroupKFold
    import joblib

    ap = argparse.ArgumentParser()
    ap.add_argument("dataset")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "models"))
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--cache", default=None, help="pickle file to cache extracted features")
    ap.add_argument("--cover", type=float, default=0.35)
    ap.add_argument("--holdout", default="val,test", help="dataset splits kept out of the shipped model so they stay genuinely held out")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    imgs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(args.dataset, "annotated_dataset", "images", "*", "*"))}
    labs = {os.path.splitext(os.path.basename(p))[0]: p for p in glob.glob(os.path.join(args.dataset, "annotated_dataset", "labels", "*", "*.txt"))}
    keys = sorted(k for k in imgs if k in labs)
    split_of = {k: os.path.basename(os.path.dirname(imgs[k])) for k in keys}
    holdout = set(args.holdout.split(",")) if args.holdout else set()
    t0 = time.time()
    import pickle
    if args.cache and os.path.exists(args.cache):
        res = pickle.load(open(args.cache, "rb"))
    else:
        with ProcessPoolExecutor(max_workers=args.workers) as ex:
            res = [r for r in ex.map(extract, [(k, imgs[k], labs[k]) for k in keys]) if r]
        if args.cache:
            pickle.dump(res, open(args.cache, "wb"))
    print(f"features for {len(res)} images in {time.time() - t0:.0f}s")

    items, X, y, g, owner = [], [], [], [], []
    for n, (key, W, H, s, gt, rows) in enumerate(res):
        items.append(dict(key=key, W=W, H=H, s=s, gt=gt, cand=[r[0] for r in rows]))
        for i, (c, f, bb, best) in enumerate(rows):
            if best >= 0.5 or best < 0.3:
                X.append(f); y.append(1 if best >= 0.5 else 0); g.append(group_of(key)); owner.append((n, i))
    X, y, g = np.stack(X), np.array(y), np.array(g)
    print(f"candidates: {len(y)} labelled ({int(y.sum())} positive / {int((1 - y).sum())} negative)")

    def make():
        return HistGradientBoostingClassifier(max_depth=6, learning_rate=0.07, max_iter=250, l2_regularization=1.0, random_state=0)

    # ---- grouped CV: probabilities for every candidate of every image come from a model that never saw that image's group
    all_prob = [np.zeros(len(it["cand"])) for it in items]
    img_group = np.array([group_of(it["key"]) for it in items])
    for fold, (tr, te) in enumerate(GroupKFold(n_splits=5).split(np.arange(len(items)), groups=img_group)):
        tr_groups = set(img_group[tr])
        mask = np.array([group_of(items[o[0]]["key"]) in tr_groups for o in owner])
        clf = make().fit(X[mask], y[mask])
        # predict on every candidate (including unlabelled ones) of the held-out images
        for n in te:
            feats = np.stack([r[1] for r in res[n][5]]) if res[n][5] else np.zeros((0, len(D.FEATURES)))
            if len(feats):
                all_prob[n] = clf.predict_proba(feats)[:, 1]
        print(f"fold {fold + 1}/5 done")
    COVER = args.cover
    sweep = [end_to_end(items, all_prob, t) for t in (0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8)]
    for r in sweep:
        print(r)
    best = max(sweep, key=lambda r: r["f1"])

    # shipped model: fit on the training split only, so the val/test photos stay genuinely unseen
    fit_mask = np.array([split_of[items[o[0]]["key"]] not in holdout for o in owner])
    final = make().fit(X[fit_mask], y[fit_mask])
    joblib.dump(final, os.path.join(args.out, "logend_verifier.joblib"))
    held_idx = [n for n, it in enumerate(items) if split_of[it["key"]] in holdout]
    held_prob = [(final.predict_proba(np.stack([r[1] for r in res[n][5]]))[:, 1] if res[n][5] else np.zeros(0)) for n in held_idx]
    heldout = end_to_end([items[n] for n in held_idx], held_prob, best["thr"]) if held_idx else None
    heldout_images = [items[n]["key"] for n in held_idx]
    print("shipped model held-out (val+test) photos:", len(held_idx), heldout)
    meta = dict(features=D.FEATURES, threshold=best["thr"], cv=best, cv_sweep=sweep, images=len(items), candidates=int(len(y)), positives=int(y.sum()),
                trained_on_splits=sorted(set(split_of.values()) - holdout), heldout_splits=sorted(holdout), heldout=heldout, heldout_images=heldout_images,
                dataset="DIIF log-end annotated dataset, Zenodo 10.5281/zenodo.22894169 (CC BY 4.0)",
                note="cv = grouped 5-fold cross-validation over all images (held-out only); the shipped model is fit on the train split, heldout = its score on val+test photos")
    json.dump(meta, open(os.path.join(args.out, "logend_verifier.json"), "w"), indent=1)
    print("saved; best held-out threshold:", best)
