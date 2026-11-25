"""Synthetic log-pile generator with known ground truth, used to validate the detector."""
from __future__ import annotations

import json
import math
import sys

import cv2
import numpy as np


def make_pile(w=2400, h=1300, mean_mm=130, sd_mm=14, px_per_mm=0.55, seed=3, crack_fraction=0.08, rot_fraction=0.06):
    rng = np.random.default_rng(seed)
    img = np.full((h, w, 3), (92, 96, 100), np.uint8)
    noise = rng.normal(0, 6, img.shape).astype(np.int16)
    img = np.clip(img + noise, 0, 255).astype(np.uint8)
    truth = []
    # hex-ish packing of discs with varied diameters
    y = 110
    row = 0
    while y < h - 120:
        x = 150 + (row % 2) * 40
        while x < w - 150:
            d_mm = float(np.clip(rng.normal(mean_mm, sd_mm), 80, 175))
            r = d_mm * px_per_mm / 2
            ov = 1 + abs(rng.normal(0, 0.03))
            a, b = r * math.sqrt(ov), r / math.sqrt(ov)
            ang = float(rng.uniform(0, 180))
            cx, cy = x + rng.normal(0, 3), y + rng.normal(0, 3)
            # bark rim
            cv2.ellipse(img, ((cx, cy), (2 * a * 1.04, 2 * b * 1.04), ang), (38, 54, 74), -1, cv2.LINE_AA)
            base = np.array([rng.integers(150, 185), rng.integers(185, 215), rng.integers(215, 245)])  # BGR pale wood
            cv2.ellipse(img, ((cx, cy), (2 * a * 0.93, 2 * b * 0.93), ang), tuple(int(c) for c in base), -1, cv2.LINE_AA)
            for k in range(1, 7):  # growth rings
                cv2.ellipse(img, ((cx, cy), (2 * a * 0.93 * k / 7, 2 * b * 0.93 * k / 7), ang), tuple(int(c * 0.86) for c in base), 1, cv2.LINE_AA)
            has_crack = rng.random() < crack_fraction
            has_rot = rng.random() < rot_fraction
            if has_rot:
                cv2.ellipse(img, ((cx, cy), (2 * a * 0.4, 2 * b * 0.4), ang), (70, 80, 85), -1, cv2.LINE_AA)
            if has_crack:
                t = rng.uniform(0, 2 * math.pi)
                p1 = (int(cx + a * 0.1 * math.cos(t)), int(cy + b * 0.1 * math.sin(t)))
                p2 = (int(cx + a * 0.85 * math.cos(t)), int(cy + b * 0.85 * math.sin(t)))
                cv2.line(img, p1, p2, (35, 45, 55), max(2, int(r / 14)), cv2.LINE_AA)
            truth.append(dict(cx=cx, cy=cy, a=a, b=b, angle=ang, eq_mm=2 * math.sqrt(a * b) * 0.93 / px_per_mm, crack=has_crack, rot=has_rot))
            x += 2 * r * 1.06 + rng.uniform(0, 4)
        y += 2 * (mean_mm * px_per_mm / 2) * 0.9
        row += 1
    img = cv2.GaussianBlur(img, (0, 0), 1.1)
    return img, truth, px_per_mm


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "synthetic_pile.jpg"
    img, truth, ppm = make_pile()
    cv2.imwrite(out, img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    json.dump(dict(px_per_mm=ppm, logs=truth), open(out.rsplit(".", 1)[0] + ".json", "w"))
    print(out, len(truth), "logs", "mm/px =", 1 / ppm)


def make_checkerboards(n=9, cols=9, rows=6, square_mm=40.0, size=(1920, 1080), fx=1700.0, seed=5):
    """Photos of a checkerboard under random poses, rendered with a known pinhole camera (no distortion)."""
    rng = np.random.default_rng(seed)
    w, h = size
    K = np.array([[fx, 0, w / 2], [0, fx, h / 2], [0, 0, 1.0]])
    sq = 80  # texture px per square
    tex = np.zeros(((rows + 3) * sq, (cols + 3) * sq), np.uint8) + 255
    for r in range(rows + 1):
        for c in range(cols + 1):
            if (r + c) % 2 == 0:
                tex[(r + 1) * sq:(r + 2) * sq, (c + 1) * sq:(c + 2) * sq] = 0
    # board corners (mm), outer extent = (cols+1) x (rows+1) squares, offset to centre
    bw, bh = (cols + 1) * square_mm, (rows + 1) * square_mm
    pad = square_mm
    corners3d = np.array([[-pad, -pad, 0], [bw + pad, -pad, 0], [bw + pad, bh + pad, 0], [-pad, bh + pad, 0]], np.float32) - np.array([bw / 2, bh / 2, 0], np.float32)
    src = np.array([[0, 0], [tex.shape[1], 0], [tex.shape[1], tex.shape[0]], [0, tex.shape[0]]], np.float32)
    imgs, poses = [], []
    for _ in range(n):
        rv = np.array([rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(-0.4, 0.4)])
        tv = np.array([rng.uniform(-60, 60), rng.uniform(-40, 40), rng.uniform(900, 1300)])
        proj, _ = cv2.projectPoints(corners3d, rv, tv, K, None)
        Hm = cv2.getPerspectiveTransform(src, proj.reshape(4, 2).astype(np.float32))
        im = cv2.warpPerspective(tex, Hm, size, borderValue=120)
        im = cv2.GaussianBlur(im, (0, 0), 0.8)
        imgs.append(cv2.cvtColor(im, cv2.COLOR_GRAY2BGR))
    return imgs, fx
