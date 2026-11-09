"""Probabilistic and deflated Sharpe ratio, and the overfitting meter (ADR 0012).

Formulas (Bailey and Lopez de Prado, "The Deflated Sharpe Ratio"; per-period Sharpe, plain kurtosis):
  PSR(SR*) = Phi( (SR - SR*) * sqrt(T - 1) / sqrt(1 - g3*SR + (g4 - 1)/4 * SR^2) )
  SR0      = sqrt(V) * ( (1 - gamma) * Phi^-1(1 - 1/N) + gamma * Phi^-1(1 - 1/(N*e)) ),  SR0 = 0 for N = 1
  DSR      = PSR(SR0)
Moments are sample (population-style) moments: g3 = m3 / m2^1.5, g4 = m4 / m2^2 (3 for a normal distribution);
SR = mean / std with ddof = 1. Results are a warning light: trials are assumed independent with equal variance.
"""

from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np

EULER_GAMMA = 0.5772156649015329
MIN_OBS = 30
TRADING_DAYS = 252
_N = NormalDist()


def sharpe_moments(returns) -> dict:
    r = np.asarray(returns, dtype=float)
    if r.size < 2:
        raise ValueError("need at least 2 returns")
    mean, std = float(r.mean()), float(r.std(ddof=1))
    d = r - mean
    m2 = float((d ** 2).mean())
    skew = float((d ** 3).mean() / m2 ** 1.5) if m2 > 0 else 0.0
    kurt = float((d ** 4).mean() / m2 ** 2) if m2 > 0 else 0.0
    sr = mean / std if std > 1e-15 else None
    return {"T": int(r.size), "sr": sr, "skew": skew, "kurtosis": kurt, "mean": mean, "std": std}


def _psr_from_moments(sr: float, T: int, skew: float, kurt: float, benchmark_sr: float) -> tuple[float | None, str | None]:
    denom = 1 - skew * sr + (kurt - 1) / 4 * sr ** 2
    if denom <= 0:
        return None, "the variance term of the Sharpe estimator is not positive"
    return _N.cdf((sr - benchmark_sr) * math.sqrt(T - 1) / math.sqrt(denom)), None


def probabilistic_sharpe(returns, benchmark_sr: float = 0.0) -> dict:
    """Probability that the true (per-period) Sharpe exceeds `benchmark_sr` (per-period)."""
    m = sharpe_moments(returns)
    out = {**m, "benchmark_sr": benchmark_sr, "psr": None, "reason": None}
    if m["T"] < MIN_OBS:
        out["reason"] = f"fewer than {MIN_OBS} observations"
    elif m["sr"] is None:
        out["reason"] = "zero variance: Sharpe is undefined"
    else:
        out["psr"], out["reason"] = _psr_from_moments(m["sr"], m["T"], m["skew"], m["kurtosis"], benchmark_sr)
    return out


def expected_max_sharpe(n_trials: int, variance: float) -> float:
    """Expected maximum per-period Sharpe among `n_trials` independent no-skill trials with Sharpe variance `variance`."""
    if n_trials < 1:
        raise ValueError("n_trials must be >= 1")
    if variance < 0:
        raise ValueError("variance must be >= 0")
    if n_trials == 1:
        return 0.0
    return math.sqrt(variance) * ((1 - EULER_GAMMA) * _N.inv_cdf(1 - 1 / n_trials)
                                  + EULER_GAMMA * _N.inv_cdf(1 - 1 / (n_trials * math.e)))


def deflated_sharpe(returns, trial_sharpes) -> dict:
    """DSR of the chosen return series given the per-period Sharpe estimates of all N trials."""
    ts = [float(x) for x in trial_sharpes if x is not None]
    if not ts:
        raise ValueError("trial_sharpes must contain at least one value")
    var = float(np.var(ts, ddof=1)) if len(ts) > 1 else 0.0
    sr0 = expected_max_sharpe(len(ts), var)
    out = probabilistic_sharpe(returns, benchmark_sr=sr0)
    return {"n_trials": len(ts), "trial_variance": var, "sr0": sr0, "sr": out["sr"], "T": out["T"], "dsr": out["psr"],
            "reason": out["reason"]}


def overfitting_meter(conn, study_id: int) -> dict:
    """Summarise a study: N train trials, best annualised Sharpe, expected best under no skill, DSR of the best."""
    from dataclasses import replace

    from .backtest import BacktestSpec, run_backtest
    from .read import get_bars
    from .validation import study_summary

    s = study_summary(conn, study_id)
    train = [t for t in s["trials"] if t["phase"] == "train"]
    scored = [t for t in train if t["sharpe"] is not None]
    if not scored:
        raise ValueError("the study has no train trial with a defined Sharpe")
    per_period = [t["sharpe"] / math.sqrt(TRADING_DAYS) for t in scored]
    best = max(scored, key=lambda t: t["sharpe"])
    spec = BacktestSpec(symbol=s["symbol"], start=best["window_start"], end=best["window_end"],
                        fast=best["params"]["fast"], slow=best["params"]["slow"],
                        source=best["params"].get("source", "alpaca"),
                        price_basis=best["params"].get("price_basis", "split"))
    bars = get_bars(conn, spec.symbol, spec.start, spec.end, source=spec.source, adjustment=spec.price_basis)
    eq = run_backtest(bars, spec).equity["equity"].to_numpy()
    returns = eq[1:] / eq[:-1] - 1
    d = deflated_sharpe(returns, per_period)
    return {"study_id": study_id, "trials": len(train), "trials_with_sharpe": len(scored),
            "best_params": best["params"], "best_sharpe_annualised": best["sharpe"],
            "best_sharpe_per_period": d["sr"], "expected_max_sharpe_per_period": d["sr0"],
            "expected_max_sharpe_annualised": d["sr0"] * math.sqrt(TRADING_DAYS), "dsr": d["dsr"], "reason": d["reason"],
            "psr_vs_zero": probabilistic_sharpe(returns)["psr"],
            "note": "Warning light, not a verdict: trials are treated as independent; the registry cannot count ideas "
                    "tried elsewhere, so N is a lower bound."}
