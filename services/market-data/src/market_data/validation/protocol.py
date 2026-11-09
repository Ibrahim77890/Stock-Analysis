"""Validation tools (ADR 0012): trial-counting grid search, time splits with embargo, a one-use
holdout, and walk-forward analysis for the SMA-crossover strategy.

Rules: selection uses only the training bars it is given; the test run gets `slow` bars of past data as
warm-up but is scored from its first bar, starting flat; every evaluated pair is a trial and is recorded
(never deleted). Sharpe values stored and returned are annualised (252 days).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date

import polars as pl
import psycopg
from psycopg.types.json import Jsonb

from market_data.backtesting.backtest import BacktestSpec, run_backtest
from market_data.backtesting.metrics import summarise

METRICS = ("sharpe", "total_return")
MAX_GRID = 400
MIN_TRAIN_BARS = 300
MIN_TEST_BARS = 60
DEFAULT_EMBARGO = 5
FAMILY = "sma_crossover"


class HoldoutAlreadyUsedError(RuntimeError):
    """The one-use holdout of this study has already been evaluated."""


# ------------------------------------------------------------------ grid search

def _extra(spec: BacktestSpec) -> dict | None:
    """Trial params beyond (fast, slow): source and price_basis, only when not the defaults."""
    d = {}
    if spec.source != "alpaca":
        d["source"] = spec.source
    if spec.price_basis != "split":
        d["price_basis"] = spec.price_basis
    return d or None


def make_grid(fast_values, slow_values) -> list[tuple[int, int]]:
    fast_values, slow_values = list(fast_values), list(slow_values)
    for name, vals in (("fast", fast_values), ("slow", slow_values)):
        if not vals:
            raise ValueError(f"{name} values must not be empty")
        if any((not isinstance(v, int)) or v < 1 for v in vals):
            raise ValueError(f"{name} values must be integers >= 1")
        if len(set(vals)) != len(vals):
            raise ValueError(f"{name} values contain duplicates")
    pairs = [(f, s) for f in sorted(fast_values) for s in sorted(slow_values) if f < s]
    if not pairs:
        raise ValueError("grid is empty: need at least one pair with fast < slow")
    if len(pairs) > MAX_GRID:
        raise ValueError(f"grid has {len(pairs)} pairs; the maximum is {MAX_GRID}")
    return pairs


def _row(bars: pl.DataFrame, spec: BacktestSpec, fast: int, slow: int) -> dict:
    s = replace(spec, fast=fast, slow=slow, start=bars["trade_date"][0], end=bars["trade_date"][-1])
    r = run_backtest(bars, s)
    m = summarise(r.equity, r.trades)
    return {"fast": fast, "slow": slow, "total_return": m["total_return"], "sharpe": m["sharpe"], "trades": m["trades"]}


def grid_search(bars: pl.DataFrame, base_spec: BacktestSpec, grid: list[tuple[int, int]], metric: str = "sharpe") -> dict:
    """Evaluate every pair on `bars` (the caller passes the training window). Returns the ranked rows,
    the best row (None if the metric is undefined for all pairs) and the number of trials."""
    if metric not in METRICS:
        raise ValueError(f"metric must be one of {METRICS}")
    if not grid:
        raise ValueError("grid must not be empty")
    if len(grid) > MAX_GRID:
        raise ValueError(f"grid has {len(grid)} pairs; the maximum is {MAX_GRID}")
    if len(set(grid)) != len(grid):
        raise ValueError("grid contains duplicate pairs")
    if any(f < 1 or f >= s for f, s in grid):
        raise ValueError("every pair needs 1 <= fast < slow")
    rows = [_row(bars, base_spec, f, s) for f, s in grid]

    def key(r):  # best first; undefined metric last; ties: smaller slow, then smaller fast
        v = r[metric]
        return (v is None, -(v if v is not None else 0.0), r["slow"], r["fast"])

    rows.sort(key=key)
    best = rows[0] if rows and rows[0][metric] is not None else None
    return {"rows": rows, "best": best, "trials": len(rows), "metric": metric}


# ------------------------------------------------------------------ registry

def create_study(conn: psycopg.Connection, name: str, symbol: str, family: str = FAMILY) -> int:
    with conn.cursor() as cur:
        cur.execute("INSERT INTO research.study (name, family, symbol) VALUES (%s, %s, %s) RETURNING study_id",
                    (name, family, symbol))
        sid = cur.fetchone()[0]
    conn.commit()
    return sid


def _study(conn: psycopg.Connection, study_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT study_id, name, family, symbol, created_at, holdout_used_at FROM research.study "
                    "WHERE study_id = %s", (study_id,))
        r = cur.fetchone()
    if r is None:
        raise LookupError(f"unknown study_id {study_id}")
    return dict(zip(("study_id", "name", "family", "symbol", "created_at", "holdout_used_at"), r))


def record_trials(conn: psycopg.Connection, study_id: int, phase: str, rows: list[dict],
                  window: tuple[date, date], commit: bool = True, extra_params: dict | None = None) -> int:
    """Append one trial per row (fast, slow, total_return, sharpe, trades). Never edits earlier rows.

    `extra_params` (e.g. source, price_basis when not the defaults) is stored with every trial's params."""
    if phase not in ("train", "test", "holdout"):
        raise ValueError("phase must be train, test or holdout")
    _study(conn, study_id)
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO research.trial (study_id, phase, params, window_start, window_end, total_return, sharpe, trades) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            [(study_id, phase, Jsonb({"fast": r["fast"], "slow": r["slow"], **(extra_params or {})}), window[0], window[1],
              r["total_return"], r["sharpe"], r["trades"]) for r in rows])
    if commit:
        conn.commit()
    return len(rows)


def study_summary(conn: psycopg.Connection, study_id: int) -> dict:
    st = _study(conn, study_id)
    with conn.cursor() as cur:
        cur.execute("SELECT trial_id, phase, params, window_start, window_end, total_return, sharpe, trades "
                    "FROM research.trial WHERE study_id = %s ORDER BY trial_id", (study_id,))
        cols = [d.name for d in cur.description]
        trials = [dict(zip(cols, r)) for r in cur.fetchall()]
    by_phase = {p: sum(1 for t in trials if t["phase"] == p) for p in ("train", "test", "holdout")}
    train = [t["sharpe"] for t in trials if t["phase"] == "train" and t["sharpe"] is not None]
    return {**st, "trials_by_phase": by_phase, "trial_count": len(trials),
            "best_train_sharpe": max(train) if train else None, "trials": trials}


# ------------------------------------------------------------------ splits

def split_bars(n: int, train_bars: int, embargo: int = DEFAULT_EMBARGO, test_bars: int | None = None,
               holdout_bars: int = 0) -> dict:
    """Half-open index ranges over n date-sorted bars: train [0, train), test after the embargo, then
    (optionally) an embargo and the holdout at the end. Raises ValueError if they do not fit."""
    if train_bars < 1 or embargo < 0 or holdout_bars < 0 or (test_bars is not None and test_bars < 1):
        raise ValueError("train_bars >= 1, embargo >= 0, holdout_bars >= 0, test_bars >= 1 required")
    test_start = train_bars + embargo
    hold_start = n - holdout_bars if holdout_bars else n
    test_end = (hold_start - embargo if holdout_bars else n) if test_bars is None else test_start + test_bars
    if test_end <= test_start:
        raise ValueError("no room for a test block")
    if holdout_bars and test_end + embargo > hold_start:
        raise ValueError("test block overlaps the holdout (embargo included)")
    if test_end > n:
        raise ValueError("test block extends past the data")
    out = {"train": (0, train_bars), "test": (test_start, test_end)}
    if holdout_bars:
        out["holdout"] = (hold_start, n)
    return out


def _run_oos(bars: pl.DataFrame, spec: BacktestSpec, fast: int, slow: int, start: int, end: int) -> dict:
    """Run (fast, slow) on bars[start:end] with `slow` earlier bars as warm-up; score from bar `start`.
    The scored equity series begins with a baseline row (initial cash on the last warm-up date)."""
    warm = max(0, start - slow)
    window = bars[warm:end]
    s = replace(spec, fast=fast, slow=slow, start=window["trade_date"][0], end=window["trade_date"][-1])
    r = run_backtest(window, s)
    first = bars["trade_date"][start]
    eq = r.equity.filter(pl.col("trade_date") >= first)
    base = pl.DataFrame({"trade_date": [bars["trade_date"][start - 1] if start > 0 else first],
                         "equity": [spec.initial_cash], "position": [0]},
                        schema={"trade_date": pl.Date, "equity": pl.Float64, "position": pl.Int8})
    eq = pl.concat([base, eq])
    tr = r.trades.filter(pl.col("entry_date") >= first)
    return {"equity": eq, "trades": tr, "metrics": summarise(eq, tr)}


def _slim(m: dict) -> dict:
    return {k: m[k] for k in ("total_return", "sharpe", "max_drawdown", "trades", "bars")}


def evaluate_split(bars: pl.DataFrame, base_spec: BacktestSpec, grid, train_bars: int, embargo: int = DEFAULT_EMBARGO,
                   test_bars: int | None = None, metric: str = "sharpe", holdout_bars: int = 0,
                   min_train: int = MIN_TRAIN_BARS, min_test: int = MIN_TEST_BARS,
                   conn: psycopg.Connection | None = None, study_id: int | None = None) -> dict:
    """Select on the training bars only, then evaluate the chosen pair once on the test block."""
    rng = split_bars(bars.height, train_bars, embargo, test_bars, holdout_bars)
    (a, b), (c, d) = rng["train"], rng["test"]
    if b - a < min_train or d - c < min_test:
        raise ValueError(f"split too small: need >= {min_train} train and >= {min_test} test bars, got {b - a} and {d - c}")
    if max(s for _, s in grid) >= b - a:
        raise ValueError("every slow window must be shorter than the training block")
    train = bars[a:b]
    search = grid_search(train, base_spec, grid, metric)
    best = search["best"]
    if best is None:
        raise ValueError("the selection metric is undefined for every pair on the training window")
    oos = _run_oos(bars, base_spec, best["fast"], best["slow"], c, d)
    m = oos["metrics"]
    decay = None if best["sharpe"] is None or m["sharpe"] is None else best["sharpe"] - m["sharpe"]
    out = {
        "train_range": [train["trade_date"][0], train["trade_date"][-1]],
        "test_range": [bars["trade_date"][c], bars["trade_date"][d - 1]],
        "selected": {"fast": best["fast"], "slow": best["slow"]}, "metric": metric, "trials": search["trials"],
        "in_sample": {k: best[k] for k in ("total_return", "sharpe", "trades")},
        "out_of_sample": _slim(m), "decay_sharpe": decay, "train_table": search["rows"],
    }
    if conn is not None and study_id is not None:
        record_trials(conn, study_id, "train", search["rows"], (train["trade_date"][0], train["trade_date"][-1]), commit=False,
                      extra_params=_extra(base_spec))
        record_trials(conn, study_id, "test", [{**best, "total_return": m["total_return"], "sharpe": m["sharpe"],
                                                "trades": m["trades"]}], tuple(out["test_range"]),
                      extra_params=_extra(base_spec))
    return out


def final_holdout_evaluation(conn: psycopg.Connection, study_id: int, bars: pl.DataFrame, base_spec: BacktestSpec,
                             fast: int, slow: int, holdout_bars: int) -> dict:
    """Evaluate the chosen pair once on the last `holdout_bars` bars. A second call raises
    HoldoutAlreadyUsedError and records nothing."""
    st = _study(conn, study_id)
    if holdout_bars < 1 or holdout_bars >= bars.height:
        raise ValueError("holdout_bars must be between 1 and the number of bars - 1")
    with conn.cursor() as cur:
        cur.execute("UPDATE research.study SET holdout_used_at = now() WHERE study_id = %s AND holdout_used_at IS NULL "
                    "RETURNING holdout_used_at", (study_id,))
        got = cur.fetchone()
    if got is None:
        conn.rollback()
        raise HoldoutAlreadyUsedError(f"holdout of study {study_id} was already used at {st['holdout_used_at']}")
    start = bars.height - holdout_bars
    oos = _run_oos(bars, base_spec, fast, slow, start, bars.height)
    m = oos["metrics"]
    window = (bars["trade_date"][start], bars["trade_date"][-1])
    record_trials(conn, study_id, "holdout", [{"fast": fast, "slow": slow, "total_return": m["total_return"],
                                               "sharpe": m["sharpe"], "trades": m["trades"]}], window, commit=False,
                  extra_params=_extra(base_spec))
    conn.commit()
    return {"study_id": study_id, "selected": {"fast": fast, "slow": slow}, "window": list(window),
            "out_of_sample": _slim(m), "holdout_used_at": got[0]}


# ------------------------------------------------------------------ walk-forward

def make_folds(n_bars: int, train: int, test: int, embargo: int = DEFAULT_EMBARGO) -> list[dict]:
    """Rolling folds: train [k*test, k*test+train), test starts after the embargo, step = test length."""
    if train < 1 or test < 1 or embargo < 0:
        raise ValueError("train >= 1, test >= 1, embargo >= 0 required")
    if train + embargo + test > n_bars:
        raise ValueError("train + embargo + test is larger than the number of bars")
    folds, k = [], 0
    while True:
        a = k * test
        b = a + train
        c = b + embargo
        d = c + test
        if d > n_bars:
            break
        folds.append({"fold": k + 1, "train": (a, b), "test": (c, d)})
        k += 1
    return folds


def walk_forward(bars: pl.DataFrame, base_spec: BacktestSpec, grid, train: int, test: int, embargo: int = DEFAULT_EMBARGO,
                 metric: str = "sharpe", conn: psycopg.Connection | None = None, study_id: int | None = None,
                 min_train: int = MIN_TRAIN_BARS, min_test: int = MIN_TEST_BARS) -> dict:
    """Rolling walk-forward: select on each training window, trade the next block, stitch the blocks."""
    if train < min_train or test < min_test:
        raise ValueError(f"windows too small: need train >= {min_train} and test >= {min_test}")
    if max(s for _, s in grid) >= train:
        raise ValueError("every slow window must be shorter than the training window")
    folds = make_folds(bars.height, train, test, embargo)
    results, pieces, trades, prev, changes, trials = [], [], [], None, 0, 0
    for f in folds:
        (a, b), (c, d) = f["train"], f["test"]
        tr = bars[a:b]
        search = grid_search(tr, base_spec, grid, metric)
        trials += search["trials"]
        best = search["best"]
        if best is None:
            results.append({"fold": f["fold"], "skipped": "metric undefined on the training window"})
            continue
        oos = _run_oos(bars, base_spec, best["fast"], best["slow"], c, d)
        m = oos["metrics"]
        pair = (best["fast"], best["slow"])
        if prev is not None and pair != prev:
            changes += 1
        prev = pair
        pieces.append(oos["equity"])
        trades.append(oos["trades"])
        results.append({
            "fold": f["fold"], "train_range": [tr["trade_date"][0], tr["trade_date"][-1]],
            "test_range": [bars["trade_date"][c], bars["trade_date"][d - 1]],
            "selected": {"fast": pair[0], "slow": pair[1]}, "is_sharpe": best["sharpe"], "oos_sharpe": m["sharpe"],
            "oos_return": m["total_return"], "oos_trades": m["trades"], "oos_growth": m["total_return"] + 1.0})
        if conn is not None and study_id is not None:
            record_trials(conn, study_id, "train", search["rows"], (tr["trade_date"][0], tr["trade_date"][-1]), commit=False,
                          extra_params=_extra(base_spec))
            record_trials(conn, study_id, "test", [{**best, "total_return": m["total_return"], "sharpe": m["sharpe"],
                                                    "trades": m["trades"]}], tuple(results[-1]["test_range"]), commit=False,
                          extra_params=_extra(base_spec))
    if conn is not None and study_id is not None:
        conn.commit()
    if not pieces:
        raise ValueError("no fold produced a result")
    stitched = _stitch(pieces, base_spec.initial_cash)
    all_trades = pl.concat(trades) if trades else pl.DataFrame()
    metrics = summarise(stitched, all_trades) if all_trades.height else summarise(stitched, trades[0].clear())
    growth = 1.0
    for r in results:
        if "oos_growth" in r:
            growth *= r["oos_growth"]
    return {"folds": results, "fold_count": len(folds), "trials": trials, "parameter_changes": changes,
            "stitched_metrics": _slim(metrics), "stitched_growth": stitched["equity"][-1] / base_spec.initial_cash,
            "product_of_fold_growth": growth, "stitched_equity": stitched}


def _stitch(pieces: list[pl.DataFrame], initial_cash: float) -> pl.DataFrame:
    """Chain blocks by growth factor: each block (baseline row first) is rebased to 1 at its start."""
    rows = [(pieces[0]["trade_date"][0], initial_cash, 0)]
    level = initial_cash
    for p in pieces:
        eq = p["equity"].to_list()
        for d, e, pos in list(zip(p["trade_date"].to_list(), eq, p["position"].to_list()))[1:]:
            rows.append((d, level * e / eq[0], pos))
        level = rows[-1][1]
    return pl.DataFrame(rows, schema={"trade_date": pl.Date, "equity": pl.Float64, "position": pl.Int8}, orient="row")
