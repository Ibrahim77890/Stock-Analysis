"""Reproducibility hashes and storage of backtest runs in schema `research` (ADR 0010).

config_hash  = sha256(canonical JSON of {spec, dataset fingerprint, engine version})
fingerprint  = sha256 of the canonical CSV text of the exact bars used
result_hash  = sha256(canonical JSON of the rounded equity curve and trade list)
Canonical JSON: sorted keys, no whitespace, numbers in the spec as plain decimal strings.
"""

from __future__ import annotations

import hashlib
import json
from datetime import date
from decimal import Decimal

import polars as pl
import psycopg
from psycopg.types.json import Jsonb

from .backtest import DEFAULT_SOURCE, ENGINE_VERSION, BacktestSpec, full_run, spec_bars
from .read import get_bars

BAR_COLS = ("trade_date", "open", "high", "low", "close", "volume")


def canonical_json(obj) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def _dec(x: float) -> str:
    """5, 5.0 and 5.00 all become '5' so equivalent configs hash alike."""
    return format(Decimal(str(x)).normalize(), "f")


def canonical_spec(spec: BacktestSpec) -> dict:
    d = {"symbol": spec.symbol, "start": spec.start.isoformat(), "end": spec.end.isoformat(),
         "fast": spec.fast, "slow": spec.slow, "fill_model": spec.fill_model,
         "commission_bps": _dec(spec.commission_bps), "slippage_bps": _dec(spec.slippage_bps),
         "initial_cash": _dec(spec.initial_cash)}
    # Added in Sprint 05: present only when not the default, so every Sprint 03 hash is unchanged.
    if spec.source != DEFAULT_SOURCE:
        d["source"] = spec.source
    if spec.price_basis != "split":
        d["price_basis"] = spec.price_basis
    return d


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def dataset_fingerprint(bars: pl.DataFrame) -> str:
    lines = ["trade_date,open,high,low,close,volume"]
    for r in bars.select(BAR_COLS).iter_rows():
        lines.append(f"{r[0].isoformat()},{r[1]:.6f},{r[2]:.6f},{r[3]:.6f},{r[4]:.6f},{int(r[5])}")
    return _sha("\n".join(lines))


def config_hash(spec: BacktestSpec, fingerprint: str, engine_version: str = ENGINE_VERSION) -> str:
    return _sha(canonical_json({"spec": canonical_spec(spec), "dataset": fingerprint, "engine": engine_version}))


def result_hash(equity: pl.DataFrame, trades: pl.DataFrame) -> str:
    eq = [[r[0].isoformat(), round(r[1], 6), int(r[2])] for r in equity.iter_rows()]
    tr = [[r[0], r[1].isoformat(), r[2].isoformat(), round(r[3], 6), round(r[4], 6), round(r[5], 8),
           round(r[6], 6), round(r[7], 6), bool(r[8])] for r in trades.iter_rows()]
    return _sha(canonical_json({"equity": eq, "trades": tr}))


def save_run(conn: psycopg.Connection, spec: BacktestSpec, bars: pl.DataFrame, out: dict | None = None) -> dict:
    """Store a run (idempotent on config_hash). Returns {run_id, config_hash, result_hash, created}."""
    out = out or full_run(bars, spec)
    res = out["result"]
    fp = dataset_fingerprint(bars)
    ch, rh = config_hash(spec, fp), result_hash(res.equity, res.trades)
    with conn.transaction():
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO research.backtest_run (config_hash, result_hash, engine_version, spec, dataset_fingerprint, "
                "symbol, first_date, last_date, bars_used, realisable, metrics, benchmark_metrics) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (config_hash) DO NOTHING RETURNING run_id",
                (ch, rh, ENGINE_VERSION, Jsonb(spec.to_dict()), fp, spec.symbol, bars["trade_date"][0],
                 bars["trade_date"][-1], bars.height, res.realisable, Jsonb(out["metrics"]),
                 Jsonb(out["benchmark_metrics"])))
            row = cur.fetchone()
            if row is None:
                cur.execute("SELECT run_id, result_hash FROM research.backtest_run WHERE config_hash = %s", (ch,))
                run_id, stored_rh = cur.fetchone()
                return {"run_id": run_id, "config_hash": ch, "result_hash": stored_rh, "created": False}
            run_id = row[0]
            cur.executemany(
                "INSERT INTO research.backtest_trade (run_id, trade_no, entry_date, exit_date, entry_price, exit_price, "
                "shares, costs, pnl, closed) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                [(run_id, *r) for r in res.trades.iter_rows()])
            cur.executemany(
                "INSERT INTO research.backtest_equity (run_id, trade_date, equity, position) VALUES (%s,%s,%s,%s)",
                [(run_id, *r) for r in res.equity.iter_rows()])
    return {"run_id": run_id, "config_hash": ch, "result_hash": rh, "created": True}


def _row(cur) -> dict:
    cols = [d.name for d in cur.description]
    return dict(zip(cols, cur.fetchone()))


def get_run(conn: psycopg.Connection, run_id: int) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT run_id, config_hash, result_hash, engine_version, spec, dataset_fingerprint, symbol, "
                    "first_date, last_date, bars_used, realisable, metrics, benchmark_metrics, created_at "
                    "FROM research.backtest_run WHERE run_id = %s", (run_id,))
        if cur.rowcount == 0:
            raise LookupError(f"unknown run_id {run_id}")
        return _row(cur)


def list_runs(conn: psycopg.Connection, limit: int = 50) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT run_id, config_hash, symbol, first_date, last_date, realisable, engine_version, "
                    "(metrics->>'total_return')::float8 AS total_return, created_at "
                    "FROM research.backtest_run ORDER BY run_id DESC LIMIT %s", (limit,))
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def get_trades(conn: psycopg.Connection, run_id: int) -> list[dict]:
    get_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute("SELECT trade_no, entry_date, exit_date, entry_price::float8, exit_price::float8, shares::float8, "
                    "costs::float8, pnl::float8, closed FROM research.backtest_trade WHERE run_id = %s ORDER BY trade_no",
                    (run_id,))
        cols = [d.name for d in cur.description]
        return [dict(zip(cols, r)) for r in cur.fetchall()]


def get_equity(conn: psycopg.Connection, run_id: int) -> list[dict]:
    get_run(conn, run_id)
    with conn.cursor() as cur:
        cur.execute("SELECT trade_date, equity::float8, position FROM research.backtest_equity "
                    "WHERE run_id = %s ORDER BY trade_date", (run_id,))
        return [{"trade_date": r[0], "equity": r[1], "position": r[2]} for r in cur.fetchall()]


def spec_from_dict(d: dict) -> BacktestSpec:
    return BacktestSpec(symbol=d["symbol"], start=date.fromisoformat(d["start"]), end=date.fromisoformat(d["end"]),
                        fast=d["fast"], slow=d["slow"], fill_model=d["fill_model"],
                        commission_bps=float(d["commission_bps"]), slippage_bps=float(d["slippage_bps"]),
                        initial_cash=float(d["initial_cash"]), source=d.get("source", DEFAULT_SOURCE),
                        price_basis=d.get("price_basis", "split"))


def reproduce_run(conn: psycopg.Connection, run_id: int) -> dict:
    """Rebuild a stored run from its config and say whether the result is identical.

    status: reproduced | data_changed (bars differ from the stored fingerprint) |
            engine_mismatch (same data, different result: a bug or a changed engine) .
    """
    run = get_run(conn, run_id)
    spec = spec_from_dict(run["spec"])
    bars = spec_bars(conn, spec)
    fp = dataset_fingerprint(bars) if bars.height else None
    base = {"run_id": run_id, "stored_fingerprint": run["dataset_fingerprint"], "current_fingerprint": fp,
            "stored_result_hash": run["result_hash"], "engine_version": run["engine_version"],
            "current_engine_version": ENGINE_VERSION}
    if fp != run["dataset_fingerprint"]:
        return {**base, "status": "data_changed", "current_result_hash": None}
    out = full_run(bars, spec)
    rh = result_hash(out["result"].equity, out["result"].trades)
    return {**base, "status": "reproduced" if rh == run["result_hash"] else "engine_mismatch", "current_result_hash": rh}
