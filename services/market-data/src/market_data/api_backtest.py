"""Swagger section "Backtest": one endpoint per function built in Sprint 03.

POST /backtests/simulate and /backtests/metrics take your own data (no database).
The others load split-adjusted bars from the database. Only `persist=true` on /backtests/run and
POST /backtests/{run_id}/reproduce touch the `research` schema (the first writes, the second only reads).
"""

from __future__ import annotations

import math
from datetime import date
from typing import Literal

import polars as pl
import psycopg
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from . import metrics as mt, research
from .backtest import (
    BacktestSpec, backtest_from_db, break_even, check_engine_truncation, compare_fill_models, cost_sweep,
    full_run, run_backtest, spec_bars, DEFAULT_GRID,
)
from .luck import shuffle_test
from .read import get_bars


def _clean(obj):
    """NaN/inf -> None, recursively (JSON-safe)."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    return obj


def _rows(df: pl.DataFrame) -> list[dict]:
    return _clean(df.to_dicts())


class SpecIn(BaseModel):
    symbol: str = Field("AAPL", min_length=1, max_length=20)
    start: date = date(2020, 7, 27)
    end: date = date(2023, 12, 31)
    fast: int = Field(5, ge=1, le=500)
    slow: int = Field(20, ge=2, le=1000)
    fill_model: Literal["next_open", "same_close"] = Field(
        "next_open", description="next_open = decide at the close, trade at the next open (realisable). "
                                 "same_close = trade at the signal close (look-ahead, teaching only).")
    commission_bps: float = Field(0.0, ge=0, le=1000, description="Basis points of the fill value, every fill")
    slippage_bps: float = Field(0.0, ge=0, le=1000, description="Buy at price*(1+s), sell at price*(1-s)")
    initial_cash: float = Field(100_000.0, gt=0)
    source: str = Field("alpaca", min_length=1, max_length=20,
                        description="Price source to read: alpaca (IEX, from 2020) or tiingo (consolidated, from 2005). "
                                    "Sources are never mixed.")
    price_basis: Literal["split", "split_dividend"] = Field(
        "split", description="split = price return (Sprint 03 default); split_dividend = total return, dividends "
                             "adjusted as of the end date")
    risk_free: bool = Field(False, description="true adds sharpe_excess (excess over the previous day's 3-month "
                                               "Treasury yield, FRED DGS3MO) to /backtests/run metrics")

    @model_validator(mode="after")
    def _check(self):
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        if self.start > self.end:
            raise ValueError("start must not be after end")
        return self

    def spec(self) -> BacktestSpec:
        keys = ("symbol", "start", "end", "fast", "slow", "fill_model", "commission_bps", "slippage_bps", "initial_cash",
                "source", "price_basis")
        return BacktestSpec(**{k: getattr(self, k) for k in keys})


class SimBar(BaseModel):
    trade_date: date
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)


_GOLDEN = [(10, 10), (11, 10.5), (12, 11.5), (11, 12.5), (9, 10.5), (8, 8.5), (9, 8), (10, 9.5)]


class SimulateRequest(BaseModel):
    bars: list[SimBar] = Field(min_length=2, max_length=5000)
    fast: int = Field(2, ge=1)
    slow: int = Field(3, ge=2)
    fill_model: Literal["next_open", "same_close"] = "next_open"
    commission_bps: float = Field(0.0, ge=0)
    slippage_bps: float = Field(0.0, ge=0)
    initial_cash: float = Field(1000.0, gt=0)

    @model_validator(mode="after")
    def _check(self):
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        return self

    model_config = {"json_schema_extra": {"example": {
        "bars": [{"trade_date": f"2024-01-{i + 1:02d}", "open": o, "high": max(o, c) + 0.5, "low": min(o, c) - 0.5, "close": c}
                 for i, (c, o) in enumerate(_GOLDEN)],
        "fast": 2, "slow": 3, "fill_model": "next_open", "commission_bps": 0, "slippage_bps": 0, "initial_cash": 1000}}}


class MetricsRequest(BaseModel):
    equity: list[float] = Field(min_length=1, max_length=100_000, examples=[[100, 110, 99, 120]])


class ExcessRequest(BaseModel):
    equity: list[float] = Field(min_length=3, max_length=100_000, examples=[[100, 101, 100.5, 102, 103]])
    rf_daily: list[float] = Field(min_length=3, max_length=100_000, examples=[[0.0002, 0.0002, 0.0002, 0.0002, 0.0002]])

    @model_validator(mode="after")
    def _len(self):
        if len(self.rf_daily) != len(self.equity):
            raise ValueError("rf_daily must have one value per equity point")
        return self


class RunRequest(SpecIn):
    persist: bool = Field(False, description="true writes the run to research.* (idempotent on the config hash)")
    include_equity: bool = False


class SweepRequest(SpecIn):
    grid_bps: list[float] = Field(list(DEFAULT_GRID), min_length=1, max_length=20)
    include_commission: bool = Field(False, description="also apply the grid value as commission bps")


class ShuffleRequest(SpecIn):
    method: Literal["block_bootstrap", "gbm"] = "block_bootstrap"
    n_paths: int = Field(100, ge=1, le=1000)
    block_length: int = Field(20, ge=1, le=500)
    seed: int = Field(1, ge=0)
    include_paths: bool = False


class CausalityRequest(SpecIn):
    cut_points: int = Field(30, ge=1, le=200)
    seed: int = Field(1, ge=0)


def make_router(conn_dep) -> APIRouter:
    from fastapi import Depends

    r = APIRouter(prefix="/backtests", tags=["Backtest"])
    Conn = Depends(conn_dep)

    def _bars(conn, s: BacktestSpec) -> pl.DataFrame:
        bars = spec_bars(conn, s)
        if bars.height < 2:
            raise HTTPException(404, f"fewer than 2 bars for {s.symbol} between {s.start} and {s.end}")
        return bars

    @r.post("/simulate", summary="run_backtest on YOUR bars (no database); the golden example is prefilled")
    def simulate(req: SimulateRequest) -> dict:
        bars = pl.DataFrame([b.model_dump() for b in req.bars]).with_columns(pl.lit(0).alias("volume"))
        s = BacktestSpec(symbol="SIM", start=bars["trade_date"].min(), end=bars["trade_date"].max(), fast=req.fast,
                         slow=req.slow, fill_model=req.fill_model, commission_bps=req.commission_bps,
                         slippage_bps=req.slippage_bps, initial_cash=req.initial_cash)
        out = full_run(bars, s)
        res = out["result"]
        return _clean({"realisable": res.realisable, "equity": _rows(res.equity), "trades": _rows(res.trades),
                       "metrics": out["metrics"], "benchmark_metrics": out["benchmark_metrics"]})

    @r.post("/metrics", summary="summarise: metrics of an equity curve you type in (no database)")
    def metrics_endpoint(req: MetricsRequest) -> dict:
        eq = req.equity
        return _clean({"total_return": mt.total_return(eq), "cagr": mt.cagr(eq),
                       "annualised_volatility": mt.annualised_volatility(eq), "sharpe": mt.sharpe(eq),
                       "max_drawdown": mt.max_drawdown(eq), "conventions": "252 days, ddof=1, risk-free rate 0"})

    @r.post("/excess-sharpe", summary="excess_sharpe: Sharpe over a risk-free series you type in (no database)")
    def excess(req: ExcessRequest) -> dict:
        return _clean({"sharpe": mt.sharpe(req.equity), "sharpe_excess": mt.excess_sharpe(req.equity, req.rf_daily),
                       "convention": "rf_daily[i] is earned over the return from i-1 to i and must be known before day i; "
                                     "the first value is unused"})

    @r.post("/run", summary="run_backtest on database bars (+ buy-and-hold); persist=true saves it with hashes")
    def run(req: RunRequest, conn: psycopg.Connection = Conn) -> dict:
        s = req.spec()
        bars = _bars(conn, s)
        rf = None
        if req.risk_free:
            from .macro import daily_risk_free
            try:
                rf = daily_risk_free(conn, bars["trade_date"].to_list())
            except LookupError as exc:
                raise HTTPException(404, f"risk-free series unavailable: {exc}") from exc
        out = full_run(bars, s, rf)
        res = out["result"]
        fp = research.dataset_fingerprint(bars)
        body = {"realisable": res.realisable, "bars_used": bars.height, "first_date": bars["trade_date"][0],
                "last_date": bars["trade_date"][-1], "dataset_fingerprint": fp,
                "config_hash": research.config_hash(s, fp), "result_hash": research.result_hash(res.equity, res.trades),
                "metrics": out["metrics"], "benchmark_metrics": out["benchmark_metrics"], "trades": _rows(res.trades)}
        if req.include_equity:
            body["equity"] = _rows(res.equity)
        if req.persist:
            body["stored"] = research.save_run(conn, s, bars, out)
        return _clean(body)

    @r.post("/fill-model-comparison", summary="look-ahead detector: next_open vs same_close on the same strategy")
    def fill_models(req: SpecIn, conn: psycopg.Connection = Conn) -> dict:
        s = req.spec()
        return _clean(compare_fill_models(_bars(conn, s), s))

    @r.post("/cost-sweep", summary="cost_sweep: rerun across a grid of costs and estimate the break-even cost")
    def sweep(req: SweepRequest, conn: psycopg.Connection = Conn) -> dict:
        s = req.spec()
        rows = cost_sweep(_bars(conn, s), s, req.grid_bps, req.include_commission)
        return _clean({"rows": rows, "break_even_zero_bps": break_even(rows, "zero"),
                       "break_even_vs_buy_and_hold_bps": break_even(rows, "benchmark"),
                       "note": "null = still above the baseline at the largest grid value; 0 = not above it even at the first value"})

    @r.post("/shuffle-test", summary="shuffle_test: rank the real result among bootstrap / random-walk paths")
    def shuffle(req: ShuffleRequest, conn: psycopg.Connection = Conn) -> dict:
        s = req.spec()
        out = shuffle_test(_bars(conn, s), s, req.method, req.n_paths, req.block_length, req.seed)
        if not req.include_paths:
            out.pop("paths")
        return _clean(out)

    @r.post("/causality-check", summary="check_engine_truncation: equity at t must not depend on data after t")
    def causality(req: CausalityRequest, conn: psycopg.Connection = Conn) -> dict:
        s = req.spec()
        _bars(conn, s)
        mism = check_engine_truncation(s, lambda t: get_bars(conn, s.symbol, s.start, t, source=s.source, adjustment=s.price_basis),
                                       req.cut_points, req.seed)
        return _clean({"passed": not mism, "cut_points": req.cut_points, "mismatches": mism})

    @r.get("", summary="list_runs: stored runs, newest first")
    def runs(limit: int = Query(50, ge=1, le=500), conn: psycopg.Connection = Conn) -> list[dict]:
        return _clean(research.list_runs(conn, limit))

    def _lookup(fn, conn, run_id):
        try:
            return fn(conn, run_id)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @r.get("/{run_id}", summary="get_run: one stored run with metrics and hashes")
    def run_detail(run_id: int, conn: psycopg.Connection = Conn) -> dict:
        return _clean(_lookup(research.get_run, conn, run_id))

    @r.get("/{run_id}/trades", summary="get_trades: trades of a stored run")
    def run_trades(run_id: int, conn: psycopg.Connection = Conn) -> list[dict]:
        return _clean(_lookup(research.get_trades, conn, run_id))

    @r.get("/{run_id}/equity", summary="get_equity: daily equity of a stored run")
    def run_equity(run_id: int, conn: psycopg.Connection = Conn) -> list[dict]:
        return _clean(_lookup(research.get_equity, conn, run_id))

    @r.post("/{run_id}/reproduce", summary="reproduce_run: rebuild from the stored config and compare result hashes")
    def reproduce(run_id: int, conn: psycopg.Connection = Conn) -> dict:
        return _clean(_lookup(research.reproduce_run, conn, run_id))

    return r
