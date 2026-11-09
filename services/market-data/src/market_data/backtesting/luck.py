"""Luck controls: run the same strategy on synthetic paths built from the real bars (ADR 0011).

Methods
- block_bootstrap: draw blocks of consecutive "bar relatives" (open/prev close, high/open, low/open,
  close/open, volume) with replacement and rebuild OHLCV. Keeps each bar's shape, the asset's drift and
  short-range structure inside a block; destroys longer-range ordering (trends).
- gbm: independent normal log returns with the real mean and sample std (a random walk, no memory);
  gaps and intraday extremes are drawn independently from the real distribution.
The first bar is the real first bar, so every path starts at the real first close and has the same length.
The result is a teaching aid, not a significance test.
"""

from __future__ import annotations

import numpy as np
import polars as pl

from market_data.backtesting.backtest import BacktestSpec, run_backtest
from market_data.backtesting.metrics import summarise

METHODS = ("block_bootstrap", "gbm")
QUANTILES = (5, 25, 50, 75, 95)


def _relatives(bars: pl.DataFrame) -> dict[str, np.ndarray]:
    o, h, l, c = (bars[x].to_numpy().astype(float) for x in ("open", "high", "low", "close"))
    return {
        "gap": o[1:] / c[:-1], "hi": h[1:] / o[1:], "lo": l[1:] / o[1:], "cl": c[1:] / o[1:],
        "hi_extra": h[1:] / np.maximum(o[1:], c[1:]), "lo_extra": l[1:] / np.minimum(o[1:], c[1:]),
        "vol": bars["volume"].to_numpy()[1:].astype(float), "logret": np.log(c[1:] / c[:-1]),
    }


def _assemble(bars: pl.DataFrame, open_: np.ndarray, high: np.ndarray, low: np.ndarray, close: np.ndarray,
              vol: np.ndarray) -> pl.DataFrame:
    first = bars.row(0, named=True)
    return pl.DataFrame({
        "trade_date": bars["trade_date"],
        "open": np.concatenate([[first["open"]], open_]), "high": np.concatenate([[first["high"]], high]),
        "low": np.concatenate([[first["low"]], low]), "close": np.concatenate([[first["close"]], close]),
        "volume": np.concatenate([[first["volume"]], np.round(vol)]).astype(np.int64),
    })


def _check(bars: pl.DataFrame) -> None:
    if bars.height < 3:
        raise ValueError("need at least 3 bars")


def block_bootstrap_path(bars: pl.DataFrame, block_length: int, rng: np.random.Generator,
                         rel: dict | None = None) -> pl.DataFrame:
    _check(bars)
    rel = rel or _relatives(bars)
    m = len(rel["gap"])
    if block_length < 1 or block_length > m:
        raise ValueError(f"block_length must be between 1 and {m}")
    idx: list[int] = []
    while len(idx) < m:
        s = int(rng.integers(0, m - block_length + 1))
        idx.extend(range(s, s + block_length))
    idx_a = np.array(idx[:m])
    gap, cl = rel["gap"][idx_a], rel["cl"][idx_a]
    close = bars["close"][0] * np.cumprod(gap * cl)
    prev = np.concatenate([[bars["close"][0]], close[:-1]])
    open_ = prev * gap
    return _assemble(bars, open_, open_ * rel["hi"][idx_a], open_ * rel["lo"][idx_a], close, rel["vol"][idx_a])


def gbm_path(bars: pl.DataFrame, rng: np.random.Generator, rel: dict | None = None) -> pl.DataFrame:
    _check(bars)
    rel = rel or _relatives(bars)
    m = len(rel["gap"])
    mu, sd = float(rel["logret"].mean()), float(rel["logret"].std(ddof=1))
    close = bars["close"][0] * np.exp(np.cumsum(rng.normal(mu, sd, m)))
    prev = np.concatenate([[bars["close"][0]], close[:-1]])
    open_ = prev * rel["gap"][rng.integers(0, m, m)]
    high = np.maximum(open_, close) * rel["hi_extra"][rng.integers(0, m, m)]
    low = np.minimum(open_, close) * rel["lo_extra"][rng.integers(0, m, m)]
    return _assemble(bars, open_, high, low, close, rel["vol"][rng.integers(0, m, m)])


def make_paths(bars: pl.DataFrame, method: str, n_paths: int, block_length: int = 20, seed: int = 1):
    """Yield n_paths synthetic frames; the same (bars, method, n_paths, block_length, seed) gives the same paths."""
    if method not in METHODS:
        raise ValueError(f"method must be one of {METHODS}")
    if n_paths < 1:
        raise ValueError("n_paths must be >= 1")
    _check(bars)
    rel = _relatives(bars)
    if method == "block_bootstrap" and not (1 <= block_length <= len(rel["gap"])):
        raise ValueError(f"block_length must be between 1 and {len(rel['gap'])}")
    for child in np.random.SeedSequence(seed).spawn(n_paths):
        rng = np.random.default_rng(child)
        yield block_bootstrap_path(bars, block_length, rng, rel) if method == "block_bootstrap" else gbm_path(bars, rng, rel)


def _stats(real: float | None, values: list[float | None]) -> dict:
    vals = np.array([v for v in values if v is not None], dtype=float)
    q = {f"p{p}": (float(np.percentile(vals, p)) if vals.size else None) for p in QUANTILES}
    if real is None or not vals.size:
        return {"real": real, "quantiles": q, "percentile_rank": None, "fraction_ge": None, "paths_with_value": int(vals.size)}
    return {"real": real, "quantiles": q, "percentile_rank": float((vals < real).mean()),
            "fraction_ge": float((vals >= real).mean()), "paths_with_value": int(vals.size)}


def shuffle_test(bars: pl.DataFrame, spec: BacktestSpec, method: str = "block_bootstrap", n_paths: int = 200,
                 block_length: int = 20, seed: int = 1) -> dict:
    """Run `spec` on the real bars and on n_paths synthetic paths; rank the real result among them."""
    real = summarise(*(lambda r: (r.equity, r.trades))(run_backtest(bars, spec)))
    per_path = []
    for path in make_paths(bars, method, n_paths, block_length, seed):
        r = run_backtest(path, spec)
        m = summarise(r.equity, r.trades)
        per_path.append({"total_return": m["total_return"], "sharpe": m["sharpe"], "trades": m["trades"]})
    return {
        "method": method, "seed": seed, "n_paths": n_paths, "block_length": block_length if method == "block_bootstrap" else None,
        "bars": bars.height,
        "total_return": _stats(real["total_return"], [p["total_return"] for p in per_path]),
        "sharpe": _stats(real["sharpe"], [p["sharpe"] for p in per_path]),
        "paths": per_path,
        "note": "Teaching aid, not a significance test: the paths keep the real asset's volatility "
                + ("and drift" if method == "block_bootstrap" else "and mean return") + ", and every parameter you try "
                "is another draw.",
    }
