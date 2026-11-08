"""Returns and causal indicators (pure functions on a date-sorted frame of one instrument).

Contract: input has `trade_date` (ascending, else ValueError) and `close`; each function returns
a Series with the same length, null during the warm-up, never filled from the future.
Feed adjusted prices (see adjust.py); raw prices jump at splits.
Conventions: EMA alpha = 2/(n+1), recursive form (adjust=False), seeded with the first close and
null until n values exist; volatility = sample std (ddof=1) of simple returns over n days,
annualised by sqrt(252).
"""

import math
import random
from typing import Callable

import polars as pl

TRADING_DAYS = 252


def _check(df: pl.DataFrame) -> None:
    if "close" not in df.columns or "trade_date" not in df.columns:
        raise ValueError("frame needs trade_date and close columns")
    if not df["trade_date"].is_sorted():
        raise ValueError("bars must be sorted by trade_date ascending")


def simple_return(df: pl.DataFrame) -> pl.Series:
    _check(df)
    return df.select((pl.col("close") / pl.col("close").shift(1) - 1).alias("simple_return")).to_series()


def log_return(df: pl.DataFrame) -> pl.Series:
    _check(df)
    return df.select((pl.col("close") / pl.col("close").shift(1)).log().alias("log_return")).to_series()


def sma(df: pl.DataFrame, n: int) -> pl.Series:
    """Mean of the last n closes including today; null for the first n-1 days."""
    _check(df)
    _positive(n)
    return df.select(pl.col("close").rolling_mean(window_size=n).alias(f"sma_{n}")).to_series()


def ema(df: pl.DataFrame, n: int) -> pl.Series:
    """Exponential moving average, alpha 2/(n+1); null for the first n-1 days."""
    _check(df)
    _positive(n)
    return df.select(
        pl.col("close").ewm_mean(alpha=2.0 / (n + 1), adjust=False, min_samples=n).alias(f"ema_{n}")
    ).to_series()


def rolling_volatility(df: pl.DataFrame, n: int, annualise: bool = True) -> pl.Series:
    """Sample std of the last n simple returns; null until n returns exist."""
    _check(df)
    _positive(n)
    scale = math.sqrt(TRADING_DAYS) if annualise else 1.0
    ret = pl.col("close") / pl.col("close").shift(1) - 1
    return df.select((ret.rolling_std(window_size=n, ddof=1) * scale).alias(f"vol_{n}")).to_series()


def _positive(n: int) -> None:
    if not isinstance(n, int) or n < 1:
        raise ValueError("window n must be an integer >= 1")


INDICATORS: dict[str, Callable[..., pl.Series]] = {
    "simple_return": simple_return, "log_return": log_return, "sma": sma, "ema": ema,
    "volatility": rolling_volatility,
}


def validate_spec(spec: str) -> None:
    """Raise ValueError for an unknown indicator or a missing window, without computing anything."""
    name, _, arg = spec.partition(":")
    if name not in INDICATORS:
        raise ValueError(f"unknown indicator '{name}'; choose from {sorted(INDICATORS)}")
    if name not in ("simple_return", "log_return") and not arg.isdigit():
        raise ValueError(f"indicator '{name}' needs a window, e.g. {name}:20")


def compute(df: pl.DataFrame, spec: str) -> pl.Series:
    """Compute one indicator from a spec such as 'sma:20', 'ema:50', 'volatility:20', 'simple_return'."""
    validate_spec(spec)
    name, _, arg = spec.partition(":")
    fn = INDICATORS[name]
    return fn(df) if name in ("simple_return", "log_return") else fn(df, int(arg))


def check_truncation(fn: Callable[[pl.DataFrame], pl.Series], df: pl.DataFrame, cut_points: int = 100,
                     seed: int = 7, tol: float = 1e-9) -> list[int]:
    """Causality test: the value at t from the full series must equal the value at t computed
    from the series cut at t. Returns the cut indices that violate it (empty = causal)."""
    _check(df)
    full = fn(df).to_list()
    rng = random.Random(seed)
    cuts = sorted({rng.randrange(0, df.height) for _ in range(cut_points)})
    bad = []
    for t in cuts:
        part = fn(df.head(t + 1)).to_list()[t]
        a = full[t]
        if (a is None) != (part is None) or (a is not None and abs(a - part) > tol * max(1.0, abs(a))):
            bad.append(t)
    return bad
