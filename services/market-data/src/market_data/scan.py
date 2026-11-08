"""Universe scan and the best-of-N control (ADR 0012, concept 04_05).

The same strategy is run on every eligible symbol; the best symbol's Sharpe is then compared with the
best of N simulated random-walk symbols (each built from its own symbol's mean and volatility), so that a
maximum is compared with a maximum.
"""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import polars as pl

from . import luck
from .backtest import BacktestSpec, run_backtest
from .metrics import summarise
from .read import get_bars, list_instruments

UNIVERSE_CAVEAT = ("The universe is the current-day symbol list (survivors only), prices are the free IEX feed, and the "
                   "window is short; symbols are correlated, so the effective number of independent symbols is below N. "
                   "Nothing here estimates how the rule would have done on the whole market.")
QUANTILES = (5, 25, 50, 75, 95)


def load_universe(conn, spec: BacktestSpec, symbols=None, min_bars: int = 500):
    """Return ({symbol: bars}, skipped[{symbol, reason}]). Unknown symbols raise ValueError."""
    known = {r["symbol"]: r for r in list_instruments(conn)}
    if symbols is not None:
        unknown = [s for s in symbols if s not in known]
        if unknown:
            raise ValueError(f"unknown symbols: {unknown}")
        wanted = list(dict.fromkeys(symbols))
    else:
        wanted = sorted(known)
    bars_by, skipped = {}, []
    for sym in wanted:
        bars = get_bars(conn, sym, spec.start, spec.end, adjustment="split")
        if bars.height < min_bars:
            skipped.append({"symbol": sym, "reason": f"only {bars.height} bars in the window (minimum {min_bars})"})
        else:
            bars_by[sym] = bars
    if not bars_by:
        raise ValueError("no eligible symbol")
    return bars_by, skipped


def _sharpe(bars: pl.DataFrame, spec: BacktestSpec) -> tuple[dict, float | None]:
    s = replace(spec, start=bars["trade_date"][0], end=bars["trade_date"][-1])
    r = run_backtest(bars, s)
    m = summarise(r.equity, r.trades)
    return m, m["sharpe"]


def scan_bars(bars_by_symbol: dict[str, pl.DataFrame], spec: BacktestSpec) -> dict:
    rows = []
    for sym, bars in bars_by_symbol.items():
        m, sh = _sharpe(bars, spec)
        rows.append({"symbol": sym, "bars": bars.height, "total_return": m["total_return"], "sharpe": sh, "trades": m["trades"]})
    rows.sort(key=lambda r: (r["sharpe"] is None, -(r["sharpe"] or 0.0), r["symbol"]))
    vals = np.array([r["sharpe"] for r in rows if r["sharpe"] is not None], dtype=float)
    q = {f"p{p}": (float(np.percentile(vals, p)) if vals.size else None) for p in QUANTILES}
    return {"n": len(rows), "rows": rows, "sharpe_quantiles": q,
            "best_sharpe": float(vals.max()) if vals.size else None, "median_sharpe": q["p50"]}


def universe_scan(conn, spec: BacktestSpec, symbols=None, min_bars: int = 500) -> dict:
    bars_by, skipped = load_universe(conn, spec, symbols, min_bars)
    out = scan_bars(bars_by, spec)
    return {**out, "skipped": skipped, "window": [spec.start, spec.end], "caveat": UNIVERSE_CAVEAT}


def best_of_n_from_bars(bars_by_symbol: dict[str, pl.DataFrame], spec: BacktestSpec, replicates: int = 100,
                        seed: int = 1) -> dict:
    if replicates < 1:
        raise ValueError("replicates must be >= 1")
    if not bars_by_symbol:
        raise ValueError("no eligible symbol")
    syms = list(bars_by_symbol)
    real = scan_bars(bars_by_symbol, spec)
    rel = {s: luck._relatives(b) for s, b in bars_by_symbol.items()}
    maxima = []
    for child in np.random.SeedSequence(seed).spawn(replicates):
        best = None
        for sym, sub in zip(syms, child.spawn(len(syms))):
            path = luck.gbm_path(bars_by_symbol[sym], np.random.default_rng(sub), rel[sym])
            _, sh = _sharpe(path, spec)
            if sh is not None and (best is None or sh > best):
                best = sh
        if best is not None:
            maxima.append(best)
    arr = np.array(maxima, dtype=float)
    rb = real["best_sharpe"]
    return {
        "n_symbols": len(syms), "replicates": replicates, "seed": seed, "real_best_sharpe": rb,
        "control_max_sharpe_quantiles": {f"p{p}": (float(np.percentile(arr, p)) if arr.size else None) for p in QUANTILES},
        "percentile_rank": float((arr < rb).mean()) if arr.size and rb is not None else None,
        "fraction_ge": float((arr >= rb).mean()) if arr.size and rb is not None else None,
        "note": "Compares the real best-of-N Sharpe with the best of N random-walk paths (same N). A teaching aid, "
                "not a significance test.",
    }


def best_of_n_control(conn, spec: BacktestSpec, symbols=None, replicates: int = 100, seed: int = 1, min_bars: int = 500) -> dict:
    bars_by, skipped = load_universe(conn, spec, symbols, min_bars)
    out = best_of_n_from_bars(bars_by, spec, replicates, seed)
    return {**out, "skipped": skipped, "caveat": UNIVERSE_CAVEAT}
