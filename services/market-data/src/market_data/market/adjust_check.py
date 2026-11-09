"""External check of our as-of dividend adjustment against Tiingo's adjusted close (task 05_06).

Vendor `adjClose` stays in the local raw file only (never loaded). Both series are split- and
dividend-adjusted, but the vendor adjusts to *today* while ours adjusts to the window end, so the
ratio `ours_close / vendor_adjClose` should be a near-constant (the product of later events). A
drifting ratio would mean the two disagree about some event inside the window.
Tolerance (ADR 0013, Appendix A): (p95 / p5 - 1) of the ratio <= 0.5 %.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import polars as pl
import psycopg

from market_data.core import config
from market_data.ingestion.download import raw_files
from market_data.ingestion.download_tiingo import raw_dir
from market_data.market.read import get_bars

SPREAD_TOLERANCE = 0.005


def vendor_adjusted_close(symbol: str, data_dir: Path | None = None) -> pl.DataFrame:
    files = raw_files(raw_dir(data_dir), symbol)
    if not files:
        raise FileNotFoundError(f"no Tiingo raw file for {symbol}")
    raw = pl.read_parquet(files[-1])
    return raw.select(pl.col("date").str.slice(0, 10).str.to_date().alias("trade_date"),
                      pl.col("adjClose").alias("vendor_adj_close"))


def ratio_stats(ratio: pl.Series) -> dict:
    if ratio.len() == 0:
        raise ValueError("no overlapping dates")
    med = float(ratio.median())
    p5, p95 = float(ratio.quantile(0.05)), float(ratio.quantile(0.95))
    return {"n": ratio.len(), "median": med, "p5": p5, "p95": p95, "spread_p95_over_p5": p95 / p5 - 1.0,
            "max_abs_deviation_from_median": float(((ratio / med) - 1.0).abs().max())}


def adjustment_vs_vendor(conn: psycopg.Connection, symbol: str, data_dir: Path | None = None,
                         end: date | None = None, source: str = "tiingo") -> dict:
    vendor = vendor_adjusted_close(symbol, data_dir)
    end = end or vendor["trade_date"].max()
    ours = get_bars(conn, symbol, date(1900, 1, 1), end, source=source, adjustment="split_dividend")
    j = ours.select("trade_date", "close", "factor").join(vendor, on="trade_date", how="inner")
    st = ratio_stats(j["close"] / j["vendor_adj_close"])
    st.update({"symbol": symbol, "ours_dates": ours.height, "vendor_dates": vendor.height,
               "tolerance": SPREAD_TOLERANCE, "within_tolerance": st["spread_p95_over_p5"] <= SPREAD_TOLERANCE,
               "note": ("The median is the product of vendor adjustments after the window end; only the spread "
                        "and the maximum deviation indicate disagreement inside the window.")})
    return st
