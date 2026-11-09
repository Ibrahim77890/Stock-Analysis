"""Performance metrics on an equity curve (conventions in docs/02-domain/backtest.md).

Conventions: 252 trading days per year; daily return r_t = E_t / E_(t-1) - 1; volatility = sample
std (ddof=1) of r times sqrt(252); Sharpe = mean(r) / std(r) * sqrt(252) with risk-free rate 0;
CAGR = (E_n / E_0) ** (252 / n) - 1 with n daily returns; max drawdown = min(E_t / max(E_0..E_t) - 1).
Undefined values are None (never infinity, never a division error).
"""

from __future__ import annotations

import math
from typing import Sequence

import polars as pl

TRADING_DAYS = 252
ZERO_STD = 1e-12


def _values(equity) -> list[float]:
    if isinstance(equity, pl.DataFrame):
        equity = equity["equity"]
    vals = [float(x) for x in (equity.to_list() if isinstance(equity, pl.Series) else equity)]
    if not vals:
        raise ValueError("equity is empty")
    if any(v < 0 for v in vals) or vals[0] <= 0:
        raise ValueError("equity must be positive (first value > 0, none negative)")
    return vals


def daily_returns(equity) -> list[float]:
    v = _values(equity)
    return [b / a - 1 for a, b in zip(v, v[1:]) if a > 0]


def total_return(equity) -> float:
    """E_n / E_0 - 1."""
    v = _values(equity)
    return v[-1] / v[0] - 1


def cagr(equity) -> float | None:
    """(E_n / E_0) ** (252 / n) - 1 where n is the number of daily returns; None if n < 1."""
    v = _values(equity)
    n = len(v) - 1
    return None if n < 1 else (v[-1] / v[0]) ** (TRADING_DAYS / n) - 1


def _std(r: Sequence[float]) -> float | None:
    if len(r) < 2:
        return None
    m = sum(r) / len(r)
    return math.sqrt(sum((x - m) ** 2 for x in r) / (len(r) - 1))


def annualised_volatility(equity) -> float | None:
    """Sample std (ddof=1) of daily returns times sqrt(252); None with fewer than 2 returns."""
    s = _std(daily_returns(equity))
    return None if s is None else s * math.sqrt(TRADING_DAYS)


def _annualised_ratio(r: Sequence[float]) -> float | None:
    s = _std(r)
    if s is None or s < ZERO_STD:
        return None
    return (sum(r) / len(r)) / s * math.sqrt(TRADING_DAYS)


def sharpe(equity) -> float | None:
    """mean(r) / std(r) * sqrt(252), risk-free rate 0; None when std is zero or fewer than 2 returns."""
    return _annualised_ratio(daily_returns(equity))


def excess_sharpe(equity, rf_daily: Sequence[float]) -> float | None:
    """mean(r - rf) / std(r - rf, ddof=1) * sqrt(252).

    `rf_daily` has one value per equity date (same length as `equity`); the value at position i is the
    risk-free return earned over the return from i-1 to i (it must be known BEFORE day i, e.g. the
    previous day's yield / 252). The first value is not used. None when std is zero or < 2 returns."""
    v = _values(equity)
    if len(rf_daily) != len(v):
        raise ValueError(f"rf_daily must have one value per equity date ({len(v)}), got {len(rf_daily)}")
    ex = [(b / a - 1) - rf for a, b, rf in zip(v, v[1:], rf_daily[1:]) if a > 0]
    return _annualised_ratio(ex)


def max_drawdown(equity) -> float:
    """Most negative E_t / running peak - 1 (0 if the curve never falls)."""
    peak, worst = -math.inf, 0.0
    for x in _values(equity):
        peak = max(peak, x)
        worst = min(worst, x / peak - 1)
    return worst


def exposure(position) -> float | None:
    """Share of days with an open position."""
    if isinstance(position, pl.DataFrame):
        position = position["position"]
    p = position.to_list() if isinstance(position, pl.Series) else list(position)
    return None if not p else sum(1 for x in p if x) / len(p)


def trade_stats(trades: pl.DataFrame) -> dict:
    """Count, win rate, average pnl, total costs (None for the ratios when there are no trades)."""
    n = trades.height
    if n == 0:
        return {"trades": 0, "win_rate": None, "avg_pnl": None, "total_costs": 0.0}
    return {"trades": n, "win_rate": float((trades["pnl"] > 0).sum()) / n,
            "avg_pnl": float(trades["pnl"].mean()), "total_costs": float(trades["costs"].sum())}


def turnover(trades: pl.DataFrame, equity) -> float | None:
    """Traded value (entries plus closed exits, at fill prices) divided by average equity."""
    if trades.height == 0:
        return 0.0
    v = _values(equity)
    traded = float((trades["entry_price"] * trades["shares"]).sum()) + float(
        (trades.filter(pl.col("closed"))["exit_price"] * trades.filter(pl.col("closed"))["shares"]).sum())
    avg = sum(v) / len(v)
    return traded / avg if avg > 0 else None


def summarise(equity: pl.DataFrame, trades: pl.DataFrame, rf_daily: Sequence[float] | None = None) -> dict:
    """All metrics for one run as a plain dict (JSON-friendly). `rf_daily` adds `sharpe_excess`."""
    ts = trade_stats(trades)
    extra = {} if rf_daily is None else {"sharpe_excess": excess_sharpe(equity, rf_daily)}
    return {
        "bars": equity.height,
        "total_return": total_return(equity),
        "cagr": cagr(equity),
        "annualised_volatility": annualised_volatility(equity),
        "sharpe": sharpe(equity),
        "max_drawdown": max_drawdown(equity),
        "exposure": exposure(equity),
        "turnover": turnover(trades, equity),
        **ts,
        **extra,
    }
