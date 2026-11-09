"""Scoring of probability forecasts (pure functions: no database, no I/O). Sprint 06, task 06_04.

A forecast is p = P(close `h` bars ahead is higher than now), clipped to [0.01, 0.99]; the outcome y is 1 if it was
higher (strictly) and 0 otherwise. Lower Brier score is better; a constant 0.5 scores exactly 0.25.
All numbers shown to the learner come from here (the browser computes nothing). See docs/02-domain/scoring.md.
"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

P_MIN, P_MAX = 0.01, 0.99
COIN_FLIP = 0.25
MIN_ENOUGH = 30          # fewer resolved forecasts than this: no skill statement
SPARSE_BIN = 5           # fewer forecasts than this in a bin: shown but flagged
Z95 = 1.96
N_PERM = 5000


def validate(forecasts: Sequence[float], outcomes: Sequence[int]) -> tuple[np.ndarray, np.ndarray]:
    if len(forecasts) != len(outcomes):
        raise ValueError("forecasts and outcomes must have the same length")
    f = np.asarray(forecasts, dtype=float)
    y = np.asarray(outcomes, dtype=float)
    if f.size and (not np.all(np.isfinite(f)) or f.min() < P_MIN - 1e-12 or f.max() > P_MAX + 1e-12):
        raise ValueError(f"forecasts must be finite and within [{P_MIN}, {P_MAX}]")
    if y.size and not np.all(np.isin(y, (0.0, 1.0))):
        raise ValueError("outcomes must be 0 or 1")
    return f, y


def brier(forecasts, outcomes) -> float | None:
    f, y = validate(forecasts, outcomes)
    return None if f.size == 0 else float(np.mean((f - y) ** 2))


def log_loss(forecasts, outcomes) -> float | None:
    f, y = validate(forecasts, outcomes)
    if f.size == 0:
        return None
    return float(-np.mean(y * np.log(f) + (1 - y) * np.log(1 - f)))


def skill_score(bs: float | None, reference: float = COIN_FLIP) -> float | None:
    return None if bs is None else 1.0 - bs / reference


def wilson(successes: int, n: int, z: float = Z95) -> tuple[float, float]:
    """Wilson score interval for a proportion; stays inside [0, 1] and is sensible at small n."""
    if n == 0:
        raise ValueError("n must be positive")
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return max(0.0, centre - half), min(1.0, centre + half)


def _bin_index(p: np.ndarray, width: float) -> np.ndarray:
    k = int(round(1.0 / width))
    idx = np.floor(np.round(p / width, 9)).astype(int)
    return np.clip(idx, 0, k - 1)


def calibration_bins(forecasts, outcomes, width: float = 0.1) -> list[dict]:
    """Ten bins [0, 0.1) ... [0.9, 1.0] (the last includes 1.0): n, mean forecast, observed share, Wilson 95% interval."""
    f, y = validate(forecasts, outcomes)
    k = int(round(1.0 / width))
    idx = _bin_index(f, width) if f.size else np.array([], dtype=int)
    out = []
    for b in range(k):
        m = idx == b
        n = int(m.sum())
        row = {"bin_low": round(b * width, 10), "bin_high": round((b + 1) * width, 10), "n": n, "mean_forecast": None,
               "observed": None, "wilson_low": None, "wilson_high": None, "sparse": 0 < n < SPARSE_BIN}
        if n:
            s = int(y[m].sum())
            lo, hi = wilson(s, n)
            row.update(mean_forecast=float(f[m].mean()), observed=s / n, wilson_low=lo, wilson_high=hi)
        out.append(row)
    return out


def murphy_decomposition(forecasts, outcomes, width: float = 0.1) -> dict:
    """BS = REL - RES + UNC (exact when every forecast equals the mean of its bin; `exact` says whether it was)."""
    f, y = validate(forecasts, outcomes)
    if f.size == 0:
        return {"rel": None, "res": None, "unc": None, "brier": None, "exact": True}
    n = f.size
    ybar = float(y.mean())
    idx = _bin_index(f, width)
    rel = res = 0.0
    exact = True
    for b in np.unique(idx):
        m = idx == b
        nk, pk, ok = int(m.sum()), float(f[m].mean()), float(y[m].mean())
        rel += nk * (pk - ok) ** 2
        res += nk * (ok - ybar) ** 2
        exact = exact and bool(np.allclose(f[m], pk, atol=1e-12, rtol=0))
    return {"rel": rel / n, "res": res / n, "unc": ybar * (1 - ybar), "brier": float(np.mean((f - y) ** 2)), "exact": exact}


def baselines(outcomes) -> dict:
    _, y = validate([0.5] * len(outcomes), outcomes)
    base = None if y.size == 0 else float(y.mean()) * (1 - float(y.mean()))
    return {"coin_flip": COIN_FLIP, "base_rate": base, "base_rate_note": "in-sample: it uses the outcomes it is compared with, so it flatters"}


def permutation_luck(forecasts, outcomes, horizons: Sequence[int] | None = None, n_perm: int = N_PERM, seed: int = 1) -> dict:
    """Share of random re-assignments of the outcomes (within each horizon) that score at least as well as the real one.

    luck_probability = (1 + count) / (n_perm + 1): never zero. Deterministic for a seed."""
    f, y = validate(forecasts, outcomes)
    if f.size == 0:
        return {"real_brier": None, "luck_probability": None, "n_perm": n_perm, "seed": seed, "count": 0, "shuffled_quantiles": None}
    h = np.asarray(horizons if horizons is not None else [1] * f.size)
    rng = np.random.default_rng(seed)
    real = float(np.mean((f - y) ** 2))
    total = np.zeros(n_perm)
    for g in np.unique(h):
        m = h == g
        fg, yg = f[m], y[m]
        shuffled = rng.permuted(np.tile(yg, (n_perm, 1)), axis=1)
        total += ((fg[None, :] - shuffled) ** 2).sum(axis=1)
    perm = total / f.size
    count = int(np.sum(perm <= real + 1e-12))
    q = np.quantile(perm, [0.05, 0.5, 0.95])
    return {"real_brier": real, "luck_probability": (1 + count) / (n_perm + 1), "n_perm": n_perm, "seed": seed, "count": count,
            "shuffled_quantiles": {"p5": float(q[0]), "p50": float(q[1]), "p95": float(q[2])}}


def summarise(forecasts, outcomes, horizons: Sequence[int] | None = None, n_perm: int = N_PERM, seed: int = 1) -> dict:
    """Everything the score screen needs, plus warnings. Below 30 resolved forecasts `luck` is flagged `not_reported`."""
    f, y = validate(forecasts, outcomes)
    n = int(f.size)
    bs = brier(f, y)
    bins = calibration_bins(f, y)
    warnings: list[str] = []
    enough = n >= MIN_ENOUGH
    if not enough:
        warnings.append(f"too few resolved predictions to say anything (need {MIN_ENOUGH}, have {n})")
    if horizons is not None and any(int(x) > 1 for x in horizons):
        warnings.append("overlapping horizons: the effective sample is smaller than n")
    if any(b["sparse"] for b in bins):
        warnings.append("sparse bins: groups with fewer than 5 predictions are not evidence")
    luck = permutation_luck(f, y, horizons, n_perm, seed)
    luck["not_reported"] = not enough
    return {"n": n, "brier": bs, "skill_vs_coin_flip": skill_score(bs), "log_loss": log_loss(f, y), "bins": bins,
            "murphy": murphy_decomposition(f, y), "baselines": baselines(y), "luck": luck, "enough": enough,
            "min_enough": MIN_ENOUGH, "warnings": warnings}
