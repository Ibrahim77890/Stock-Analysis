"""As-of corporate-action adjustment of raw daily bars (pure functions, no database).

Rule: the factor for a bar dated `t` at cursor `as_of` is the product over actions with
`t < ex_date <= as_of`. Actions after `as_of` are never used, so an adjusted value can not
depend on the future (blueprint 23.3 item 1).

Actions frame columns: action_type ('split' | 'dividend'), ex_date, split_from, split_to,
cash_amount. Bars frame columns: trade_date, open, high, low, close, volume.
"""

from datetime import date
from enum import StrEnum

import polars as pl

PRICE_COLS = ["open", "high", "low", "close"]


class Adjustment(StrEnum):
    RAW = "raw"
    SPLIT = "split"
    SPLIT_DIVIDEND = "split_dividend"


def _splits(actions: pl.DataFrame | None, as_of: date) -> list[tuple[date, float]]:
    """(ex_date, price factor) for splits with ex_date <= as_of, ordered by date."""
    if actions is None or actions.height == 0:
        return []
    s = actions.filter((pl.col("action_type") == "split") & (pl.col("ex_date") <= as_of)).sort("ex_date")
    return [(r["ex_date"], r["split_from"] / r["split_to"]) for r in s.iter_rows(named=True)]


def split_factors(bar_dates: pl.Series, actions: pl.DataFrame | None, as_of: date) -> pl.Series:
    """One price factor per bar date: product of split_from/split_to over splits with
    bar_date < ex_date <= as_of. A 4-for-1 split gives 0.25 to every bar before the ex-date."""
    factor = pl.Series("factor", [1.0] * len(bar_dates), dtype=pl.Float64)
    for ex_date, f in _splits(actions, as_of):
        factor = factor * pl.Series(((bar_dates < ex_date).cast(pl.Float64) * (f - 1.0) + 1.0))
    return factor.alias("factor")


def dividend_factors(bars: pl.DataFrame, actions: pl.DataFrame | None, as_of: date) -> pl.Series:
    """One price factor per bar from cash dividends with ex_date <= as_of.

    For each dividend the factor is 1 - cash_amount / (raw close of the last session before the
    ex-date), applied to bars before the ex-date. Dividends with no earlier bar are skipped.
    """
    dates = bars["trade_date"]
    factor = pl.Series("factor", [1.0] * len(dates), dtype=pl.Float64)
    if actions is None or actions.height == 0:
        return factor
    divs = actions.filter((pl.col("action_type") == "dividend") & (pl.col("ex_date") <= as_of)).sort("ex_date")
    sorted_bars = bars.sort("trade_date")
    for r in divs.iter_rows(named=True):
        prev = sorted_bars.filter(pl.col("trade_date") < r["ex_date"]).tail(1)
        if prev.height == 0 or not prev["close"][0]:
            continue
        f = 1.0 - r["cash_amount"] / prev["close"][0]
        factor = factor * pl.Series(((dates < r["ex_date"]).cast(pl.Float64) * (f - 1.0) + 1.0))
    return factor.alias("factor")


def adjust_bars(
    bars: pl.DataFrame, actions: pl.DataFrame | None, as_of: date,
    mode: Adjustment | str = Adjustment.SPLIT,
) -> pl.DataFrame:
    """Return bars with trade_date <= as_of, adjusted as of `as_of`.

    Adds columns `factor` (price), `adjustment` (mode) and `as_of`. Volume is multiplied by the
    inverse split factor (shares multiply when price divides) and rounded to an integer;
    dividends do not change volume. Full float precision is kept for prices.
    """
    mode = Adjustment(mode)
    b = bars.filter(pl.col("trade_date") <= as_of).sort("trade_date")
    if mode is Adjustment.RAW:
        factor = pl.Series("factor", [1.0] * b.height, dtype=pl.Float64)
        vol_factor = factor
    else:
        sf = split_factors(b["trade_date"], actions, as_of)
        vol_factor = sf
        factor = sf
        if mode is Adjustment.SPLIT_DIVIDEND:
            factor = (sf * dividend_factors(b, actions, as_of)).alias("factor")
    out = b.with_columns(factor.alias("factor"), vol_factor.alias("_vf"))
    out = out.with_columns(
        *[(pl.col(c) * pl.col("factor")).alias(c) for c in PRICE_COLS],
        (pl.col("volume") / pl.col("_vf")).round(0).cast(pl.Int64).alias("volume"),
        pl.lit(str(mode)).alias("adjustment"), pl.lit(as_of).alias("as_of"),
    ).drop("_vf")
    return out
