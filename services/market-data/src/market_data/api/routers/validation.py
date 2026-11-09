"""Swagger section "Validation": one endpoint per function built in Sprint 04.

Pure endpoint: POST /validation/sharpe-stats (your own returns, no database).
Database endpoints read split-adjusted bars. Writes (to research.study / research.trial only) happen when
`record` is true, and on POST /validation/holdout (which is one-use per study).
"""

from __future__ import annotations

import math
from datetime import date
from typing import Literal

import polars as pl
import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator

from market_data.backtesting import metrics as mt
from market_data.validation import regimes, scan, sharpe_stats as ss, protocol as v
from market_data.backtesting.backtest import BacktestSpec, run_backtest
from market_data.market.read import get_bars, get_macro


def _clean(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(x) for k, x in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(x) for x in obj]
    return obj


class WindowIn(BaseModel):
    symbol: str = Field("SPY", min_length=1, max_length=20)
    start: date = date(2018, 11, 1)
    end: date = date(2025, 12, 31)
    commission_bps: float = Field(0.0, ge=0, le=1000)
    slippage_bps: float = Field(0.0, ge=0, le=1000)
    initial_cash: float = Field(100_000.0, gt=0)
    source: str = Field("alpaca", min_length=1, max_length=20, description="alpaca (from 2020) or tiingo (from 2005)")
    price_basis: Literal["split", "split_dividend"] = Field("split", description="split = price return; split_dividend = total return")
    risk_free: bool = Field(False, description="/validation/regimes only: adds sharpe_excess of the run (FRED DGS3MO, previous day)")

    @model_validator(mode="after")
    def _dates(self):
        if self.start > self.end:
            raise ValueError("start must not be after end")
        return self

    def spec(self, fast: int = 2, slow: int = 3) -> BacktestSpec:
        return BacktestSpec(symbol=self.symbol, start=self.start, end=self.end, fast=fast, slow=slow,
                            commission_bps=self.commission_bps, slippage_bps=self.slippage_bps, initial_cash=self.initial_cash,
                            source=self.source, price_basis=self.price_basis)


class GridIn(WindowIn):
    fast_values: list[int] = Field([3, 5, 10, 20], min_length=1, max_length=40)
    slow_values: list[int] = Field([30, 50, 100, 150], min_length=1, max_length=40)
    metric: Literal["sharpe", "total_return"] = "sharpe"

    @model_validator(mode="after")
    def _grid(self):
        v.make_grid(self.fast_values, self.slow_values)  # ValueError -> 422 (empty, duplicates, > 400 pairs)
        return self

    def pairs(self):
        return v.make_grid(self.fast_values, self.slow_values)


class SearchIn(GridIn):
    record: bool = Field(False, description="true creates a study and stores one trial per evaluated pair")


class SplitIn(SearchIn):
    train_bars: int = Field(1000, ge=1, le=100_000)
    embargo: int = Field(5, ge=0, le=500)
    test_bars: int | None = Field(None, ge=1, le=100_000)


class WalkIn(SearchIn):
    train: int = Field(500, ge=1, le=100_000)
    test: int = Field(100, ge=1, le=100_000)
    embargo: int = Field(5, ge=0, le=500)


class HoldoutIn(WindowIn):
    study_id: int = Field(ge=1)
    fast: int = Field(5, ge=1)
    slow: int = Field(20, ge=2)
    holdout_bars: int = Field(200, ge=1, le=100_000)

    @model_validator(mode="after")
    def _fs(self):
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        return self


class SharpeIn(BaseModel):
    returns: list[float] = Field(min_length=2, max_length=100_000, examples=[[0.001, -0.002, 0.003, 0.0005] * 20])
    benchmark_sr: float = Field(0.0, description="Per-period Sharpe threshold for the PSR")
    trial_sharpes: list[float] | None = Field(None, max_length=100_000,
                                               description="Per-period Sharpe estimates of ALL trials; enables the DSR")


class ScanIn(WindowIn):
    fast: int = Field(20, ge=1)
    slow: int = Field(50, ge=2)
    symbols: list[str] | None = Field(None, max_length=60)
    min_bars: int = Field(500, ge=2, le=100_000)

    @model_validator(mode="after")
    def _fs(self):
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        return self


class BestOfNIn(ScanIn):
    replicates: int = Field(50, ge=1, le=500)
    seed: int = Field(1, ge=0)


class RegimeIn(WindowIn):
    fast: int = Field(20, ge=1)
    slow: int = Field(50, ge=2)
    by: Literal["year", "vol", "vix"] = "year"

    @model_validator(mode="after")
    def _fs(self):
        if self.fast >= self.slow:
            raise ValueError("fast must be smaller than slow")
        return self


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(prefix="/validation", tags=["Validation"])
    Conn = Depends(conn_dep)

    def bars_for(conn, w: WindowIn) -> pl.DataFrame:
        bars = get_bars(conn, w.symbol, w.start, w.end, source=w.source, adjustment=w.price_basis)
        if bars.height < 2:
            raise HTTPException(404, f"fewer than 2 bars for {w.symbol} between {w.start} and {w.end}")
        return bars

    def lookup(fn, *a):
        try:
            return fn(*a)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @r.post("/grid-search", summary="grid_search: evaluate every (fast, slow) pair; record=true stores each as a trial")
    def grid_search(req: SearchIn, conn: psycopg.Connection = Conn) -> dict:
        bars = bars_for(conn, req)
        out = v.grid_search(bars, req.spec(), req.pairs(), req.metric)
        out["window"] = [bars["trade_date"][0], bars["trade_date"][-1]]
        if req.record:
            sid = v.create_study(conn, f"grid-search {req.symbol}", req.symbol)
            v.record_trials(conn, sid, "train", out["rows"], (bars["trade_date"][0], bars["trade_date"][-1]),
                            extra_params=v._extra(req.spec()))
            out["study_id"] = sid
        out["note"] = f"{out['trials']} trials were evaluated; report this number next to the best result."
        return _clean(out)

    @r.post("/split-evaluation", summary="evaluate_split: select on the training bars, test once after an embargo")
    def split_evaluation(req: SplitIn, conn: psycopg.Connection = Conn) -> dict:
        bars = bars_for(conn, req)
        sid = v.create_study(conn, f"split {req.symbol}", req.symbol) if req.record else None
        out = v.evaluate_split(bars, req.spec(), req.pairs(), req.train_bars, req.embargo, req.test_bars, req.metric,
                               conn=conn if sid else None, study_id=sid)
        if sid:
            out["study_id"] = sid
        return _clean(out)

    @r.post("/holdout", summary="final_holdout_evaluation: one use per study (409 on a second call)")
    def holdout(req: HoldoutIn, conn: psycopg.Connection = Conn) -> dict:
        bars = bars_for(conn, req)
        try:
            return _clean(v.final_holdout_evaluation(conn, req.study_id, bars, req.spec(req.fast, req.slow),
                                                     req.fast, req.slow, req.holdout_bars))
        except v.HoldoutAlreadyUsedError as exc:
            raise HTTPException(409, str(exc)) from exc
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc

    @r.post("/walk-forward", summary="walk_forward: rolling select-on-train, trade-the-next-block, stitched curve")
    def walk_forward(req: WalkIn, conn: psycopg.Connection = Conn) -> dict:
        bars = bars_for(conn, req)
        sid = v.create_study(conn, f"walk-forward {req.symbol}", req.symbol) if req.record else None
        out = v.walk_forward(bars, req.spec(), req.pairs(), req.train, req.test, req.embargo, req.metric,
                             conn=conn if sid else None, study_id=sid)
        eq = out.pop("stitched_equity")
        out["stitched_points"] = eq.height
        if sid:
            out["study_id"] = sid
        return _clean(out)

    @r.post("/sharpe-stats", summary="PSR / DSR on YOUR returns (no database); add trial_sharpes for the deflation")
    def sharpe_stats(req: SharpeIn) -> dict:
        p = ss.probabilistic_sharpe(req.returns, req.benchmark_sr)
        out = {"moments": {k: p[k] for k in ("T", "sr", "skew", "kurtosis")}, "psr": p["psr"], "reason": p["reason"],
               "sr_annualised": None if p["sr"] is None else p["sr"] * math.sqrt(ss.TRADING_DAYS)}
        if req.trial_sharpes:
            out["deflated"] = ss.deflated_sharpe(req.returns, req.trial_sharpes)
        return _clean(out)

    @r.get("/studies", summary="list studies with trial counts")
    def studies(limit: int = Query(50, ge=1, le=500), conn: psycopg.Connection = Conn) -> list[dict]:
        with conn.cursor() as cur:
            cur.execute("SELECT s.study_id, s.name, s.symbol, s.created_at, s.holdout_used_at, count(t.*) "
                        "FROM research.study s LEFT JOIN research.trial t USING (study_id) "
                        "GROUP BY s.study_id ORDER BY s.study_id DESC LIMIT %s", (limit,))
            return [dict(study_id=a, name=b, symbol=c, created_at=d, holdout_used_at=e, trials=f)
                    for a, b, c, d, e, f in cur.fetchall()]

    @r.get("/studies/{study_id}", summary="study_summary + overfitting_meter (N trials, expected best, DSR)")
    def study(study_id: int, conn: psycopg.Connection = Conn) -> dict:
        s = lookup(v.study_summary, conn, study_id)
        try:
            s["overfitting_meter"] = ss.overfitting_meter(conn, study_id)
        except ValueError as exc:
            s["overfitting_meter"] = {"reason": str(exc)}
        return _clean(s)

    @r.post("/universe-scan", summary="universe_scan: the same rule on every eligible symbol (best of N is biased)")
    def universe_scan(req: ScanIn, conn: psycopg.Connection = Conn) -> dict:
        return _clean(scan.universe_scan(conn, req.spec(req.fast, req.slow), req.symbols, req.min_bars))

    @r.post("/best-of-n", summary="best_of_n_control: real best-of-N Sharpe vs best of N random-walk symbols")
    def best_of_n(req: BestOfNIn, conn: psycopg.Connection = Conn) -> dict:
        return _clean(scan.best_of_n_control(conn, req.spec(req.fast, req.slow), req.symbols, req.replicates, req.seed,
                                             req.min_bars))

    @r.post("/regimes", summary="regime_breakdown: results by calendar year or volatility tercile (reconciled)")
    def regimes_endpoint(req: RegimeIn, conn: psycopg.Connection = Conn) -> dict:
        bars = bars_for(conn, req)
        spec = req.spec(req.fast, req.slow)
        res = run_backtest(bars, spec)
        vix = None
        if req.by == "vix":
            try:
                vix = get_macro(conn, "VIXCLS")
            except LookupError as exc:
                raise HTTPException(404, f"VIXCLS is not loaded: {exc}") from exc
        out = regimes.regime_breakdown(res, bars, req.by, vix=vix)
        if req.risk_free:
            from market_data.ingestion.macro import daily_risk_free
            try:
                rf = daily_risk_free(conn, bars["trade_date"].to_list())
            except LookupError as exc:
                raise HTTPException(404, f"risk-free series unavailable: {exc}") from exc
            out["sharpe"] = mt.sharpe(res.equity)
            out["sharpe_excess"] = mt.excess_sharpe(res.equity, rf)
        return _clean(out)

    return r
