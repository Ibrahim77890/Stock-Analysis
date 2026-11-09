"""Swagger sections "Sources" and "Macro": one endpoint per Sprint 05 function.

Writes: POST /ingestion/tiingo/load and /ingestion/fred/load (market.*), the two download endpoints (files under
data/raw/ only), POST /sources/reconcile with write_report=true (a report file). Vendor calls: the two download
endpoints and GET /sources/keys?ping=true. Keys come from .env; no response, log or error contains a key value.

This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
Tiingo data are for internal use only and FRED/CBOE series may be copyrighted: keep this service on loopback.
"""

from __future__ import annotations

import math
from datetime import date

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from market_data.core import config
from market_data.ingestion import macro as mc
from market_data.market import reconcile as rc
from market_data.market.adjust_check import adjustment_vs_vendor
from market_data.core.keys import check_keys
from market_data.market.read import UnknownSymbolError, get_macro, macro_asof, source_summary

ATTRIBUTION = mc.ATTRIBUTION


def _clean(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    return obj


class TiingoDownloadIn(BaseModel):
    symbols: list[str] | None = Field(None, max_length=60, description="default: the 53-symbol universe")
    start: date = date.fromisoformat(config.TIINGO_START)
    end: date = date.fromisoformat(config.DEFAULT_END)
    max_requests: int = Field(45, ge=1, le=50, description="HTTP requests allowed in this call (free tier: 50 per hour)")
    force: bool = False


class FredDownloadIn(BaseModel):
    series: list[str] = Field(list(mc.SERIES), min_length=1, max_length=5)
    start: date = date.fromisoformat(mc.DEFAULT_START)
    end: date = date.fromisoformat(config.DEFAULT_END)
    force: bool = False


class ReconcileIn(BaseModel):
    symbols: list[str] | None = Field(None, max_length=60)
    a: str = "alpaca"
    b: str = "tiingo"
    start: date = rc.RECON_START
    end: date = rc.RECON_END
    write_report: bool = Field(False, description="true writes reconciliation-<run>.json/.md under data/reports/")
    include_details: bool = Field(False, description="false returns totals and per-symbol counts only")


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(tags=["Sources"])
    Conn = Depends(conn_dep)

    def need_key(getter) -> None:
        try:
            getter()
        except RuntimeError as exc:   # message names the variable, never a value
            raise HTTPException(400, str(exc)) from exc

    @r.get("/sources", summary="source_summary: per price source, symbols, bars, date range, action counts")
    def sources(conn: psycopg.Connection = Conn) -> dict:
        with conn.cursor() as cur:
            cur.execute("SELECT series_id, source, count(*), count(value), min(obs_date), max(obs_date) "
                        "FROM market.macro_observation GROUP BY 1, 2 ORDER BY 1")
            macro = [dict(series_id=a, source=b, observations=c, non_null=d, nulls=c - d, first_date=e, last_date=f)
                     for a, b, c, d, e, f in cur.fetchall()]
        return _clean({"prices": source_summary(conn), "macro": macro, "fred_attribution": ATTRIBUTION})

    @r.get("/sources/keys", summary="check_keys: which API keys are set (never shown); ping=true tests them")
    def keys(ping: bool = False) -> dict:
        rep = check_keys(do_ping=ping)
        return {"keys": rep["keys"], "missing_required": rep["missing_required"]}

    @r.post("/ingestion/tiingo/download", tags=["Ingestion"],
            summary="download_tiingo: resumable raw download, 1 request per symbol (calls the vendor)")
    def tiingo_download(req: TiingoDownloadIn):
        from market_data.ingestion.download_tiingo import download_tiingo
        from market_data.core.universe import symbols as universe_symbols

        need_key(config.tiingo_key)
        syms = req.symbols or universe_symbols()
        summary = download_tiingo(syms, req.start.isoformat(), req.end.isoformat(), max_requests=req.max_requests,
                                  force=req.force)
        if summary["stopped_by"] == "quota":
            return JSONResponse(status_code=429, content={"detail": "quota reached; rerun later", "summary": summary})
        return summary

    @r.post("/ingestion/tiingo/load", tags=["Ingestion"],
            summary="load_tiingo_universe: idempotent load of raw Tiingo files as source='tiingo' (writes)")
    def tiingo_load(conn: psycopg.Connection = Conn) -> dict:
        from market_data.ingestion.load import load_tiingo_universe
        from market_data.core.universe import load_universe

        results = load_tiingo_universe(conn, load_universe())
        loaded = [x for x in results if "bars" in x]
        return _clean({"symbols_loaded": len(loaded), "skipped_no_file": [x["symbol"] for x in results if "skipped" in x],
                       "bars_inserted": sum(x["bars"]["inserted"] for x in loaded),
                       "bars_updated": sum(x["bars"]["updated"] for x in loaded),
                       "bars_rejected": sum(x["bars"]["rejected"] for x in loaded),
                       "actions_inserted": sum(x["actions"]["inserted"] for x in loaded)})

    @r.post("/sources/reconcile", summary="reconcile_universe: Alpaca vs Tiingo prices and actions; tolerances from ADR 0013")
    def reconcile(req: ReconcileIn, conn: psycopg.Connection = Conn) -> dict:
        try:
            rep = rc.reconcile_universe(conn, req.symbols, req.a, req.b, req.start, req.end)
        except ValueError as exc:
            raise HTTPException(404, str(exc)) from exc
        out = {"a": rep["a"], "b": rep["b"], "window": rep["window"], "tolerances": rep["tolerances"],
               "symbols": rep["symbols"], "totals": rep["totals"]}
        if req.include_details:
            out.update(bars=rep["bars"], actions=rep["actions"])
        else:
            out["per_symbol"] = [{k: x[k] for k in ("symbol", "matched", "only_in_a", "only_in_b", "close_mismatches",
                                                    "close_notices", "median_close_diff_bps")} for x in rep["bars"]]
        if req.write_report:
            out["report"] = rc.write_report(rep)
        return _clean(out)

    @r.get("/sources/adjustment-check/{symbol}",
           summary="adjustment_vs_vendor: our as-of split+dividend close vs Tiingo's adjusted close")
    def adjustment_check(symbol: str, conn: psycopg.Connection = Conn) -> dict:
        try:
            return _clean(adjustment_vs_vendor(conn, symbol))
        except (UnknownSymbolError, FileNotFoundError) as exc:
            raise HTTPException(404, f"{type(exc).__name__}: {exc}") from exc

    # ------------------------------------------------------------------ FRED / macro

    @r.post("/ingestion/fred/download", tags=["Macro", "Ingestion"],
            summary="download_fred: DGS3MO and VIXCLS raw files with manifests (calls the vendor). " + ATTRIBUTION)
    def fred_download(req: FredDownloadIn) -> dict:
        need_key(config.fred_key)
        try:
            return mc.download_fred(req.series, req.start.isoformat(), req.end.isoformat(), force=req.force)
        except mc.MacroError as exc:
            raise HTTPException(502, config.redact(str(exc))) from exc

    @r.post("/ingestion/fred/load", tags=["Macro", "Ingestion"],
            summary="load_fred: idempotent load into market.macro_observation (writes). " + ATTRIBUTION)
    def fred_load(conn: psycopg.Connection = Conn) -> dict:
        return {"jobs": mc.load_fred(conn), "attribution": ATTRIBUTION}

    macro = APIRouter(prefix="/macro", tags=["Macro"])

    @macro.get("/derived/risk-free", summary="daily_risk_free: rf for a date = previous observation / 100 / 252. " + ATTRIBUTION)
    def risk_free(date_: date = Query(..., alias="date"), conn: psycopg.Connection = Conn) -> dict:
        try:
            rf = mc.daily_risk_free(conn, [date_])[0]
            y = macro_asof(conn, "DGS3MO", date_, strict=True)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        return {"date": date_, "yield_percent": y["value"], "yield_observation_date": y["obs_date"],
                "rf_daily": rf, "formula": "rf = (y / 100) / 252, y = last non-null DGS3MO strictly before the date",
                "attribution": ATTRIBUTION}

    @macro.get("/derived/vix-bucket", summary="vix_labels: bucket of the previous day's VIX (low < 15, medium 15-25, high >= 25)")
    def vix_bucket(date_: date = Query(..., alias="date"), conn: psycopg.Connection = Conn) -> dict:
        try:
            obs = get_macro(conn, "VIXCLS")
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        label = mc.vix_labels(obs, [date_])[0]
        try:
            y = macro_asof(conn, "VIXCLS", date_, strict=True)
        except LookupError:
            y = None
        return {"date": date_, "label": label, "vix_observation": y, "attribution": ATTRIBUTION}

    @macro.get("/{series_id}/asof", summary="macro_asof: latest non-null value before (strict) or on/before a date. " + ATTRIBUTION)
    def asof(series_id: str, date_: date = Query(..., alias="date"), strict: bool = True,
             conn: psycopg.Connection = Conn) -> dict:
        try:
            out = macro_asof(conn, series_id, date_, strict)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        return {**out, "attribution": ATTRIBUTION}

    @macro.get("/{series_id}", summary="get_macro: observations of a series (null = FRED had no value that day). " + ATTRIBUTION)
    def observations(series_id: str, start: date | None = None, end: date | None = None,
                     limit: int = Query(500, ge=1, le=20_000), conn: psycopg.Connection = Conn) -> dict:
        try:
            df = get_macro(conn, series_id, start, end)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from exc
        return _clean({"series_id": series_id, "count": df.height, "returned": min(df.height, limit),
                       "observations": df.head(limit).to_dicts(), "attribution": ATTRIBUTION})

    r.include_router(macro)
    return r
