"""Strategy Lab (Sprint 07, task 07_02): a person tests one moving-average rule on the PRACTICE years of a stock and
may open the VAULT (the most recent years) exactly once.

This is the ONLY module that runs SQL on research.lab_study. It adds no new maths: it composes the Sprint 03 engine
(backtest, cost sweep, shuffle test) and the Sprint 04 trial registry, one-use holdout and overfitting meter.

Rules that make the lesson honest:
- the practice end date is decided when the study is created and never recomputed from "today's" data;
- practice runs read bars with `end = practice_end`, so prices are adjusted as of that date and no vault row is read;
- every distinct (fast, slow, cost_bps) run counts as one trial; repeating the same one is recomputed, not counted;
- the vault opens once per study, only for a rule that was already run on practice, and warm-up comes from practice bars.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date

import numpy as np
import polars as pl
import psycopg
from psycopg.types.json import Jsonb

from market_data.backtesting import luck
from market_data.backtesting.backtest import BacktestSpec, buy_and_hold, cost_sweep, run_backtest
from market_data.backtesting.metrics import summarise
from market_data.backtesting.research import config_hash, dataset_fingerprint
from market_data.market.read import UnknownSymbolError, bar_range_stats, get_bars, list_instruments, session_dates
from market_data.validation import protocol, sharpe_stats
from market_data.validation.protocol import HoldoutAlreadyUsedError

__all__ = ["LabLimitError", "HoldoutAlreadyUsedError", "UnknownSymbolError", "LabStudyNotFound", "eligible_symbols",
           "create_lab_study", "run_practice", "open_vault", "vault_result", "study_overview", "list_studies_info"]

FAMILY = "lab_sma"
SOURCE = "tiingo"
PRICE_BASIS = "split_dividend"
MIN_SESSIONS = 3000
DEFAULT_VAULT_BARS = 1000
EMBARGO = 5
MAX_SLOW = 300
MAX_COST_BPS = 50.0
MAX_TRIALS = 200
MAX_PATHS = 200
DEFAULT_PATHS = 100
MAX_BARS = 6000
MAX_POINTS = 300
COST_TABLE = (0, 2, 5, 10, 20)
MIN_TRADES_NOTE = 20
SHORT_WINDOW_BARS = 1260
EPOCH = date(1900, 1, 1)
METRIC_KEYS = ("total_return", "cagr", "max_drawdown", "exposure", "trades", "sharpe")


class LabLimitError(ValueError):
    """A documented limit is broken (HTTP 422)."""


class LabStudyNotFound(LookupError):
    """No lab study with this id (HTTP 404)."""


# ------------------------------------------------------------------------------------------ checks and storage

def check_rule(fast: int, slow: int, cost_bps: float) -> None:
    if not (2 <= fast < slow <= MAX_SLOW):
        raise LabLimitError(f"The short average must be at least 2 days and shorter than the long average, and the long "
                            f"average can be at most {MAX_SLOW} days (you sent {fast} and {slow}).")
    if not (0 <= cost_bps <= MAX_COST_BPS):
        raise LabLimitError(f"The cost per trade must be between 0 and {MAX_COST_BPS:g} basis points (you sent {cost_bps:g}).")


def _row(conn: psycopg.Connection, study_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT l.study_id, s.symbol, s.name, l.source, l.practice_end, l.vault_bars, l.created_at, s.holdout_used_at, "
                    "l.vault_fast, l.vault_slow, l.vault_cost_bps FROM research.lab_study l "
                    "JOIN research.study s USING (study_id) WHERE l.study_id = %s", (study_id,))
        r = cur.fetchone()
    if r is None:
        raise LabStudyNotFound(str(study_id))
    keys = ("study_id", "symbol", "name", "source", "practice_end", "vault_bars", "created_at", "holdout_used_at",
            "vault_fast", "vault_slow", "vault_cost_bps")
    return dict(zip(keys, r))


def _trials(conn: psycopg.Connection, study_id: int) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT trial_id, phase, params, total_return, sharpe, trades FROM research.trial "
                    "WHERE study_id = %s ORDER BY trial_id", (study_id,))
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def _train_trials(conn: psycopg.Connection, study_id: int) -> list[dict]:
    return [t for t in _trials(conn, study_id) if t["phase"] == "train"]


def _same_params(t: dict, fast: int, slow: int, cost_bps: float) -> bool:
    p = t["params"]
    return p.get("fast") == fast and p.get("slow") == slow and float(p.get("cost_bps", -1)) == float(cost_bps)


# ------------------------------------------------------------------------------------------ the list of stocks

def eligible_symbols(conn: psycopg.Connection, source: str = SOURCE) -> list[dict]:
    """Symbols with at least MIN_SESSIONS stored sessions: name, first date, session count and years of history."""
    out = []
    for r in list_instruments(conn, source):
        if r["bars"] >= MIN_SESSIONS:
            out.append({"symbol": r["symbol"], "name": r["name"], "sector": r["sector"], "first_date": r["first_date"],
                        "bars": r["bars"], "years": round(r["bars"] / 252, 1)})
    return out


# ------------------------------------------------------------------------------------------ studies

def create_lab_study(conn: psycopg.Connection, symbol: str, source: str = SOURCE, vault_bars: int = DEFAULT_VAULT_BARS,
                     name: str | None = None) -> dict:
    """Open a study. The practice end is the last bar before the embargo and the vault; vault dates are not returned."""
    if not (120 <= vault_bars <= 1500):
        raise LabLimitError("The vault must hold between 120 and 1,500 trading days.")
    dates = session_dates(conn, symbol, EPOCH, source)  # UnknownSymbolError for an unknown symbol
    if len(dates) < MIN_SESSIONS:
        raise LabLimitError(f"{symbol} has only {len(dates)} stored trading days; the Lab needs at least {MIN_SESSIONS:,}.")
    practice_idx = len(dates) - vault_bars - EMBARGO - 1
    if practice_idx + 1 < 1000:
        raise LabLimitError("That vault would leave fewer than 1,000 practice days.")
    practice_end = dates[practice_idx]
    study_id = protocol.create_study(conn, (name or f"Lab {symbol}")[:80], symbol, family=FAMILY)
    try:
        with conn.cursor() as cur:
            cur.execute("INSERT INTO research.lab_study (study_id, source, practice_end, vault_bars) VALUES (%s,%s,%s,%s)",
                        (study_id, source, practice_end, vault_bars))
        conn.commit()
    except Exception:
        conn.rollback()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM research.study WHERE study_id = %s", (study_id,))
        conn.commit()
        raise
    return {"study_id": study_id, "symbol": symbol, "name": (name or f"Lab {symbol}")[:80],
            "practice_bars": practice_idx + 1, "practice_years": round((practice_idx + 1) / 252, 1),
            "vault_bars": vault_bars, "vault_years": round(vault_bars / 252, 1), "vault_open": False}


def _practice_bars(conn: psycopg.Connection, row: dict) -> pl.DataFrame:
    bars = get_bars(conn, row["symbol"], EPOCH, row["practice_end"], source=row["source"], adjustment=PRICE_BASIS)
    if bars.height > MAX_BARS:
        raise LabLimitError(f"A run can use at most {MAX_BARS:,} trading days.")
    return bars


def _spec(row: dict, bars: pl.DataFrame, fast: int, slow: int, cost_bps: float) -> BacktestSpec:
    return BacktestSpec(symbol=row["symbol"], start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=fast, slow=slow,
                        fill_model="next_open", commission_bps=0.0, slippage_bps=float(cost_bps), source=row["source"],
                        price_basis=PRICE_BASIS)


def _picked(m: dict) -> dict:
    return {k: m[k] for k in METRIC_KEYS}


def _downsample(n: int) -> list[int]:
    if n <= MAX_POINTS:
        return list(range(n))
    idx = np.unique(np.round(np.linspace(0, n - 1, MAX_POINTS)).astype(int))
    return [int(i) for i in idx]


def _growth(rule_eq: pl.DataFrame, bh_eq: pl.DataFrame, base: float | None = None) -> dict:
    """Both curves as growth of 100 (relative to `base`, default the first value), same dates, at most MAX_POINTS
    points, first and last always kept."""
    d = rule_eq["trade_date"].to_list()
    base = base or rule_eq["equity"][0]
    r = (rule_eq["equity"] / base * 100).to_list()
    b = (bh_eq["equity"] / (base or bh_eq["equity"][0]) * 100).to_list()
    keep = _downsample(len(d))
    return {"dates": [d[i].isoformat() for i in keep], "rule": [round(r[i], 2) for i in keep],
            "buy_hold": [round(b[i], 2) for i in keep]}


def _yearly(rule_eq: pl.DataFrame, bh_eq: pl.DataFrame, base: float | None = None) -> list[dict]:
    """Calendar-year change of both curves (the first year starts at `base`, default the first value)."""
    d = rule_eq["trade_date"].to_list()
    r, b = rule_eq["equity"].to_list(), bh_eq["equity"].to_list()
    last_idx: dict[int, int] = {}
    for i, x in enumerate(d):
        last_idx[x.year] = i
    out, pr, pb = [], base or r[0], base or b[0]
    for y in sorted(last_idx):
        i = last_idx[y]
        out.append({"year": y, "rule": r[i] / pr - 1, "buy_hold": b[i] / pb - 1})
        pr, pb = r[i], b[i]
    return out


def _luck(bars: pl.DataFrame, spec: BacktestSpec, n_paths: int, seed: int) -> dict:
    t = luck.shuffle_test(bars, spec, method="block_bootstrap", n_paths=n_paths, block_length=20, seed=seed)["total_return"]
    q = t["quantiles"]
    return {"method": "block_bootstrap", "n_paths": n_paths, "seed": seed, "real_total_return": t["real"],
            "percentile_rank": t["percentile_rank"], "fraction_as_good": t["fraction_ge"],
            "median": q["p50"], "p5": q["p5"], "p95": q["p95"],
            "note": "Mixed-up histories keep the stock's ups and downs but shuffle their order. This tests timing luck only."}


def run_practice(conn: psycopg.Connection, study_id: int, fast: int, slow: int, cost_bps: float = 2.0, seed: int = 1,
                 n_paths: int = DEFAULT_PATHS) -> dict:
    """Run the rule on the practice years: rule vs buy and hold, yearly table, cost table, luck check, trial counted."""
    check_rule(fast, slow, cost_bps)
    if not (10 <= n_paths <= MAX_PATHS):
        raise LabLimitError(f"The luck check uses between 10 and {MAX_PATHS} mixed-up histories (you sent {n_paths}).")
    row = _row(conn, study_id)
    train = _train_trials(conn, study_id)
    already = any(_same_params(t, fast, slow, cost_bps) for t in train)
    if not already and len(train) >= MAX_TRIALS:
        raise LabLimitError(f"A study can hold at most {MAX_TRIALS} tried ideas.")
    bars = _practice_bars(conn, row)
    spec = _spec(row, bars, fast, slow, cost_bps)
    res, bh = run_backtest(bars, spec), buy_and_hold(bars, spec)
    m, bm = summarise(res.equity, res.trades), summarise(bh.equity, bh.trades)
    sweep = cost_sweep(bars, spec, COST_TABLE)
    lk = _luck(bars, spec, n_paths, seed)
    counted = not already
    if counted:
        protocol.record_trials(conn, study_id, "train",
                               [{"fast": fast, "slow": slow, "total_return": m["total_return"], "sharpe": m["sharpe"], "trades": m["trades"]}],
                               (bars["trade_date"][0], bars["trade_date"][-1]),
                               extra_params={"source": row["source"], "price_basis": PRICE_BASIS, "cost_bps": float(cost_bps)})
    train = _train_trials(conn, study_id)
    meter = None
    if len(train) >= 2:
        try:
            meter = sharpe_stats.overfitting_meter(conn, study_id)
        except ValueError:
            meter = None
    warnings = []
    if m["trades"] < MIN_TRADES_NOTE:
        warnings.append(f"The rule made only {m['trades']} trades. That is too few to learn much from.")
    if bars.height < SHORT_WINDOW_BARS:
        warnings.append("The practice window is shorter than five years.")
    return {
        "study_id": study_id, "symbol": row["symbol"], "counted": counted, "trial_count": len(train),
        "params": {"fast": fast, "slow": slow, "cost_bps": float(cost_bps), "seed": seed, "n_paths": n_paths},
        "practice_years": round(bars.height / 252, 1), "practice_bars": bars.height,
        "rule": _picked(m), "buy_hold": _picked(bm),
        "growth": _growth(res.equity, bh.equity), "yearly": _yearly(res.equity, bh.equity),
        "costs": [{"cost_bps": r["cost_bps"], "total_return": r["total_return"], "sharpe": r["sharpe"],
                   "trades": r["trades"], "buy_hold_total_return": r["benchmark_total_return"]} for r in sweep],
        "luck": lk, "overfitting_meter": _meter_view(meter), "warnings": warnings,
        "config_hash": config_hash(spec, dataset_fingerprint(bars)),
    }


def _meter_view(m: dict | None) -> dict | None:
    if not m:
        return None
    return {"trials": m["trials"], "best_sharpe": m["best_sharpe_annualised"],
            "expected_best_sharpe_by_luck": m["expected_max_sharpe_annualised"], "dsr": m["dsr"],
            "note": "The more rules you try, the better the best one looks by luck alone. A warning light, not a verdict."}


# ------------------------------------------------------------------------------------------ the vault

def _vault_frames(conn: psycopg.Connection, row: dict) -> tuple[pl.DataFrame, int]:
    """Bars adjusted as of the vault end, and the index where the vault starts (read only when the vault is opened)."""
    after = session_dates(conn, row["symbol"], row["practice_end"], row["source"])  # after[0] is the practice end
    need = 1 + EMBARGO + row["vault_bars"]
    if len(after) < need:
        raise LabLimitError("There is not enough stored data after the practice years to fill the vault.")
    vault_end = after[need - 1]
    bars = get_bars(conn, row["symbol"], EPOCH, vault_end, source=row["source"], adjustment=PRICE_BASIS)
    return bars, bars.height - row["vault_bars"]


def _vault_numbers(conn: psycopg.Connection, row: dict, fast: int, slow: int, cost_bps: float) -> dict:
    bars, start = _vault_frames(conn, row)
    spec = _spec(row, bars, fast, slow, cost_bps)
    oos = protocol._run_oos(bars, spec, fast, slow, start, bars.height)
    window = bars[start:]
    bh = buy_and_hold(window, replace(spec, start=window["trade_date"][0], end=window["trade_date"][-1]))
    bm = summarise(bh.equity, bh.trades)
    rule_eq = oos["equity"].slice(1)  # drop the baseline row so the curve starts on the first vault day
    return {"rule": _picked(oos["metrics"]), "buy_hold": _picked(bm),
            "growth": _growth(rule_eq, bh.equity, spec.initial_cash),
            "yearly": _yearly(rule_eq, bh.equity, spec.initial_cash), "vault_years": round(row["vault_bars"] / 252, 1), "vault_bars": row["vault_bars"]}


def _practice_view(conn: psycopg.Connection, row: dict, fast: int, slow: int, cost_bps: float) -> dict:
    """The same rule and buy and hold on the practice years (engine only, no luck check, nothing recorded)."""
    bars = _practice_bars(conn, row)
    spec = _spec(row, bars, fast, slow, cost_bps)
    res, bh = run_backtest(bars, spec), buy_and_hold(bars, spec)
    return {"rule": _picked(summarise(res.equity, res.trades)), "buy_hold": _picked(summarise(bh.equity, bh.trades)),
            "years": round(bars.height / 252, 1)}


def open_vault(conn: psycopg.Connection, study_id: int, fast: int, slow: int, cost_bps: float = 2.0) -> dict:
    """Spend the study's single vault use on a rule that was already run on practice. A second call raises
    HoldoutAlreadyUsedError and changes nothing."""
    check_rule(fast, slow, cost_bps)
    row = _row(conn, study_id)
    if row["holdout_used_at"] is not None:
        raise HoldoutAlreadyUsedError(f"the vault of study {study_id} was already opened")
    train = _train_trials(conn, study_id)
    practice = next((t for t in train if _same_params(t, fast, slow, cost_bps)), None)
    if practice is None:
        raise LabLimitError("Run this exact rule on the practice years first, then open the vault with it.")
    bars, start = _vault_frames(conn, row)
    spec = _spec(row, bars, fast, slow, cost_bps)
    with conn.cursor() as cur:  # not committed here: protocol.final_holdout_evaluation commits it, or rolls it back
        cur.execute("UPDATE research.lab_study SET vault_fast=%s, vault_slow=%s, vault_cost_bps=%s "
                    "WHERE study_id=%s AND vault_fast IS NULL", (fast, slow, float(cost_bps), study_id))
    protocol.final_holdout_evaluation(conn, study_id, bars, spec, fast, slow, row["vault_bars"])
    out = _vault_numbers(conn, row, fast, slow, cost_bps)
    out.update({"study_id": study_id, "params": {"fast": fast, "slow": slow, "cost_bps": float(cost_bps)},
                "practice": _practice_view(conn, row, fast, slow, cost_bps), "ideas_tried": len(train)})
    return out


def vault_result(conn: psycopg.Connection, study_id: int) -> dict:
    """The saved vault result of an opened vault (recomputed, deterministic). LabLimitError when it is still closed."""
    row = _row(conn, study_id)
    if row["holdout_used_at"] is None or row["vault_fast"] is None:
        raise LabLimitError("The vault of this study has not been opened yet.")
    fast, slow, cost = row["vault_fast"], row["vault_slow"], row["vault_cost_bps"]
    out = _vault_numbers(conn, row, fast, slow, cost)
    train = _train_trials(conn, study_id)
    out.update({"study_id": study_id, "params": {"fast": fast, "slow": slow, "cost_bps": float(cost)},
                "practice": _practice_view(conn, row, fast, slow, cost), "ideas_tried": len(train)})
    return out


# ------------------------------------------------------------------------------------------ overview

def study_overview(conn: psycopg.Connection, study_id: int) -> dict:
    """Trials, counts and whether the vault is open. No vault date and no vault number before the vault is opened."""
    row = _row(conn, study_id)
    train = _train_trials(conn, study_id)
    practice_bars = bar_range_stats(conn, row["symbol"], row["practice_end"], row["source"])["bars"]
    return {
        "study_id": study_id, "symbol": row["symbol"], "name": row["name"],
        "practice_years": round(practice_bars / 252, 1), "practice_bars": practice_bars,
        "vault_years": round(row["vault_bars"] / 252, 1), "vault_bars": row["vault_bars"],
        "vault_open": row["holdout_used_at"] is not None,
        "ideas_tried": len(train),
        "trials": [{"order": i + 1, "fast": t["params"]["fast"], "slow": t["params"]["slow"],
                    "cost_bps": float(t["params"].get("cost_bps", 0)), "total_return": t["total_return"],
                    "sharpe": t["sharpe"], "trades": t["trades"]} for i, t in enumerate(train)],
    }


def list_studies_info(conn: psycopg.Connection, study_ids: list[int]) -> list[dict]:
    """Short cards (symbol, ideas tried, vault open) for the gateway's list; unknown ids are skipped."""
    out = []
    for sid in study_ids[:200]:
        try:
            o = study_overview(conn, sid)
        except LabStudyNotFound:
            continue
        out.append({k: o[k] for k in ("study_id", "symbol", "name", "practice_years", "vault_years", "vault_open", "ideas_tried")})
    return out
