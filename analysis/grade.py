"""Scale estimation, per-log + per-truck grading, volume/weight estimates."""
from __future__ import annotations

import math

import numpy as np

DEFAULT_RULES = dict(
    grade_a_min_mm=110.0,
    grade_b_min_mm=90.0,
    max_crack_pct=30.0,
    max_ovality=1.15,
    reject_rot_pct=8.0,
    wood_density_kg_m3=900.0,
)


def estimate_scale(logs, mode: str, mm_per_px=None, ref_width_mm=2400.0, ref_mean_mm=None):
    """Returns (mm_per_px, description)."""
    if mode == "mm_per_px" and mm_per_px:
        return float(mm_per_px), f"rig calibration {mm_per_px:.4f} mm/px"
    if not logs:
        return float(mm_per_px or 1.0), "no logs"
    if mode == "ref_mean" and ref_mean_mm:
        mean_px = float(np.mean([2 * math.sqrt(L.a * L.b) for L in logs]))
        return float(ref_mean_mm) / mean_px, f"mean log diameter assumed {ref_mean_mm:.0f} mm"
    # ref_width: horizontal extent of the stack ~= bunk width
    # the bunk width includes the bark rim, which is not part of the measured end-face
    left = np.percentile([L.cx - 1.04 * L.a for L in logs], 0.5)
    right = np.percentile([L.cx + 1.04 * L.a for L in logs], 99.5)
    extent = max(right - left, 1.0)
    return float(ref_width_mm) / extent, f"stack width {ref_width_mm:.0f} mm over {extent:.0f}px"


def grade_log(d_mm: float, crack, rot, oval: float, rules: dict) -> tuple[str, list[str]]:
    why = []
    if rot is not None and rot >= rules["reject_rot_pct"]:
        return "R", [f"heart rot {rot:.1f}%"]
    if d_mm < rules["grade_b_min_mm"]:
        return "C", [f"sub-gauge {d_mm:.0f}mm"]
    a_ok = d_mm >= rules["grade_a_min_mm"] and (crack is None or crack < rules["max_crack_pct"]) and oval <= rules["max_ovality"]
    if a_ok:
        return "A", why
    if d_mm >= rules["grade_a_min_mm"]:
        if crack is not None and crack >= rules["max_crack_pct"]:
            why.append(f"crack {crack:.1f}%")
        if oval > rules["max_ovality"]:
            why.append(f"ovality {oval:.2f}")
    return "B", why


def truck_grade(grades: list[str], mean_mm: float) -> dict:
    n = max(len(grades), 1)
    pct = {g: 100.0 * grades.count(g) / n for g in "ABCR"}
    if pct["R"] > 3 or pct["C"] > 25:
        grade, action, tone, review = ("C", "Divert to Pulp Pelletizing", "bad", True) if pct["R"] <= 3 else ("C?", "Halt • Divert to Biomass", "bad", True)
    elif pct["A"] >= 60:
        grade, action, tone, review = "A", "To Continuous Digester 01", "ok", False
    else:
        grade, action, tone, review = "B", "To Secondary Chipper Line", "ok", False
    return dict(grade=grade, action=action, tone=tone, needs_review=review, pct=pct, purity=round(pct["A"] + pct["B"], 1))


def volume_weight(d_mm: np.ndarray, length_m: float, density: float):
    vol = float(np.sum(math.pi * (d_mm / 2000.0) ** 2 * length_m))
    return vol, vol * density
