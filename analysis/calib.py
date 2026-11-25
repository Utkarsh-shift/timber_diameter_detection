"""Real camera calibration from checkerboard images (Zhang's method via OpenCV)."""
from __future__ import annotations

import cv2
import numpy as np


def calibrate(images: list[np.ndarray], cols: int = 9, rows: int = 6, square_mm: float = 40.0):
    """cols x rows = number of INNER corners. Returns intrinsics, distortion, RMS and mm/px at the board plane."""
    objp = np.zeros((rows * cols, 3), np.float32)
    objp[:, :2] = np.mgrid[0:cols, 0:rows].T.reshape(-1, 2) * square_mm
    obj_pts, img_pts, used, sizes, sq_px = [], [], [], [], []
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 40, 1e-4)
    for i, im in enumerate(images):
        g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
        ok, corners = cv2.findChessboardCornersSB(g, (cols, rows), cv2.CALIB_CB_EXHAUSTIVE | cv2.CALIB_CB_ACCURACY)
        if not ok:
            ok, corners = cv2.findChessboardCorners(g, (cols, rows), cv2.CALIB_CB_ADAPTIVE_THRESH | cv2.CALIB_CB_NORMALIZE_IMAGE)
            if ok:
                corners = cv2.cornerSubPix(g, corners, (11, 11), (-1, -1), crit)
        if ok:
            obj_pts.append(objp)
            img_pts.append(corners)
            used.append(i)
            sizes.append(g.shape[::-1])
            c = corners.reshape(rows, cols, 2)
            sq_px.append(float(np.mean(np.linalg.norm(np.diff(c, axis=1), axis=2))))
    if len(used) < 3:
        raise ValueError(f"Found the {cols}x{rows} pattern in only {len(used)} of {len(images)} images (need at least 3).")
    size = sizes[0]
    rms, K, dist, rvecs, tvecs = cv2.calibrateCamera(obj_pts, img_pts, size, None, None)
    # per-view reprojection error
    errs = []
    for op, ip, rv, tv in zip(obj_pts, img_pts, rvecs, tvecs):
        proj, _ = cv2.projectPoints(op, rv, tv, K, dist)
        errs.append(float(np.sqrt(np.mean(np.sum((proj.reshape(-1, 2) - ip.reshape(-1, 2)) ** 2, axis=1)))))
    return dict(
        K=dict(fx=float(K[0, 0]), fy=float(K[1, 1]), cx=float(K[0, 2]), cy=float(K[1, 2])),
        dist=dict(k1=float(dist[0, 0]), k2=float(dist[0, 1]), p1=float(dist[0, 2]), p2=float(dist[0, 3]), k3=float(dist[0, 4]) if dist.shape[1] > 4 else 0.0),
        rms=float(rms), per_view=errs, used=len(used), total=len(images), size=list(size),
        mm_per_px=float(square_mm / np.mean(sq_px)),
    )
