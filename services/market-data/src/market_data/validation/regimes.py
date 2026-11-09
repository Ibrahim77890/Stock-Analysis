"""Regime breakdown of a backtest by calendar year, trailing volatility or VIX bucket (concepts 04_06, 05_05).

Growth factor of a group = product of (1 + daily equity return) over its days; the product over all groups
equals the run's total growth (checked, else ValueError). Volatility labels use the trailing 20-day annualised
volatility known at the PREVIOUS close; tercile thresholds use the full sample (descriptive, not causal).
"""

from __future__ import annotations

import numpy as np
import polars as pl

from market_data.market import indicators
from market_data.backtesting.backtest import BacktestResult

BY = ("year", "vol", "vix")
VOL_WINDOW = 20
MIN_BARS_VOL = 25
VOL_ORDER = ["warmup", "unknown", "low", "medium", "high"]


def regime_labels(bars: pl.DataFrame, by: str, vix: pl.DataFrame | None = None) -> list[str]:
    """`vix` (columns obs_date, value; from read.get_macro) is required for by='vix'."""
    if by not in BY:
        raise ValueError(f"by must be one of {BY}")
    if by == "vix":
        if vix is None:
            raise ValueError("by='vix' needs the VIXCLS observations (vix=...)")
        from market_data.ingestion.macro import vix_labels

        return vix_labels(vix, bars["trade_date"].to_list())
    if by == "year":
        return [str(d.year) for d in bars["trade_date"].to_list()]
    if bars.height < MIN_BARS_VOL:
        raise ValueError(f"need at least {MIN_BARS_VOL} bars for volatility labels")
    vol = indicators.rolling_volatility(bars, VOL_WINDOW).shift(1).to_list()  # known at the previous close
    vals = np.array([v for v in vol if v is not None], dtype=float)
    lo, hi = np.percentile(vals, [100 / 3, 200 / 3])
    return ["warmup" if v is None else ("low" if v <= lo else ("medium" if v <= hi else "high")) for v in vol]


def regime_breakdown(result: BacktestResult, bars: pl.DataFrame, by: str, vix: pl.DataFrame | None = None) -> dict:
    eq = result.equity
    if eq["trade_date"].to_list() != bars["trade_date"].to_list():
        raise ValueError("equity and bars must cover the same dates")
    labels = regime_labels(bars, by, vix)
    cash = result.spec.initial_cash
    levels = eq["equity"].to_list()
    prev = [cash] + levels[:-1]
    pos = eq["position"].to_list()
    groups: dict[str, dict] = {}
    for lab, e, p, x in zip(labels, levels, prev, pos):
        g = groups.setdefault(lab, {"label": lab, "days": 0, "days_in_market": 0, "growth": 1.0, "trades": 0})
        g["days"] += 1
        g["days_in_market"] += 1 if x else 0
        g["growth"] *= e / p
    date_label = dict(zip(eq["trade_date"].to_list(), labels))
    for t in result.trades.iter_rows(named=True):
        groups[date_label[t["entry_date"]]]["trades"] += 1
    total = levels[-1] / cash
    product = 1.0
    for g in groups.values():
        product *= g["growth"]
    if abs(product - total) > 1e-9 * max(1.0, abs(total)):
        raise ValueError(f"regime growth factors do not reconcile: {product} vs {total}")
    order = sorted(groups) if by == "year" else [x for x in VOL_ORDER if x in groups]
    out = []
    for lab in order:
        g = groups[lab]
        out.append({"label": lab, "days": g["days"], "share_in_market": g["days_in_market"] / g["days"],
                    "growth_factor": g["growth"], "return": g["growth"] - 1.0, "trades_started": g["trades"]})
    return {"by": by, "groups": out, "total_growth": total, "product_of_group_growth": product,
            "note": ("Calendar-year attribution." if by == "year" else
                     ("VIX buckets are fixed in advance (low < 15, medium 15 to 25, high >= 25) and use the previous "
                      "trading day's VIXCLS close; 'unknown' = no earlier observation. This product uses the FRED API "
                      "but is not endorsed or certified by the Federal Reserve Bank of St. Louis." if by == "vix" else
                      "Volatility terciles use thresholds from the full sample (descriptive, hindsight); each day's "
                      "label uses only volatility known at the previous close."))}
