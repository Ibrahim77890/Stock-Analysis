"""HTTP API (FastAPI + Swagger UI at /docs) exposing every function of the market-data service.

Sections (Swagger tags):
  Reference, Bars, Adjustment, Indicators, Replay, Lineage, Data quality, Ingestion, Benchmark, Backtest.
Read endpoints never write. The pure-function endpoints (POST /adjust/preview, /indicators/compute,
/indicators/causality-check, /quality/rules/check) take your own sample data so each function can
be tested by hand. Endpoints under "Ingestion" and POST /quality/run change data or call Alpaca;
they are for the local owner only (the server binds to 127.0.0.1).
"""

import json
import math
import uuid
from datetime import date
from typing import Any, Iterator

import polars as pl
import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from market_data import config, indicators as ind, quality as q
from market_data.adjust import Adjustment, adjust_bars
from market_data.lineage import lineage as build_lineage
from market_data.read import UnknownSymbolError, get_actions, get_bars, list_instruments
from market_data.replay import ReplaySession, blind_view, new_session, visible_bars

DESCRIPTION = __doc__

app = FastAPI(
    title="MarketLab market-data API", version="0.2.0", description=DESCRIPTION,
    openapi_tags=[
        {"name": "Reference", "description": "Health, instruments, universe and corporate actions."},
        {"name": "Bars", "description": "Daily bars with cursor (replay boundary) and as-of adjustment."},
        {"name": "Adjustment", "description": "The pure adjustment function on your own sample data."},
        {"name": "Indicators", "description": "Returns and causal indicators; plus the truncation (causality) check."},
        {"name": "Replay", "description": "Server-side cursor sessions: the viewer can never see past the cursor."},
        {"name": "Lineage", "description": "Where a symbol's bars came from, and caveats."},
        {"name": "Data quality", "description": "Stored quality results, pure rule checks on sample data, and a run trigger."},
        {"name": "Ingestion", "description": "Raw-file verification, download from Alpaca, load into PostgreSQL, job history."},
        {"name": "Benchmark", "description": "Stored benchmark results (Sprint 01 and 02)."},
        {"name": "Backtest", "description": "Honest backtests: simulate, metrics, runs with hashes, fill-model comparison, "
                                            "cost sweep, shuffle test, causality check, reproduce. Only persist=true writes."},
    ],
)


# --------------------------------------------------------------------------- plumbing

def get_conn() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(config.database_url())
    try:
        yield conn
    finally:
        conn.close()


Conn = Depends(get_conn)

from market_data.api_backtest import make_router  # noqa: E402  (needs get_conn defined above)

app.include_router(make_router(get_conn))


@app.exception_handler(UnknownSymbolError)
async def _unknown_symbol(_: Request, exc: UnknownSymbolError):
    return JSONResponse(status_code=404, content={"detail": f"unknown symbol: {exc}"})


@app.exception_handler(ValueError)
async def _bad_value(_: Request, exc: ValueError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


def rows(df: pl.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe rows (NaN/inf become null)."""
    floats = [c for c, t in df.schema.items() if t.is_float()]
    if floats:
        df = df.with_columns([pl.when(pl.col(c).is_finite()).then(pl.col(c)).otherwise(None).alias(c) for c in floats])
    return df.to_dicts()


class BarRow(BaseModel):
    trade_date: date | None = None
    day: int | None = Field(None, description="Blind view only: day 1..n instead of a date")
    open: float | None = None
    high: float | None = None
    low: float | None = None
    close: float | None = None
    volume: int | None = None
    factor: float | None = Field(None, description="Cumulative price factor applied (adjusted modes)")
    adjustment: str | None = None
    as_of: date | None = None
    indicators: dict[str, float | None] | None = None


class BarsResponse(BaseModel):
    symbol: str | None
    adjustment: str
    cursor: date | None
    count: int
    bars: list[BarRow]


def to_bar_response(df: pl.DataFrame, symbol: str | None, adjustment: str, cursor: date | None,
                    indicator_cols: list[str] | None = None) -> BarsResponse:
    items = rows(df)
    ind_cols = indicator_cols or []
    out = []
    for r in items:
        extra = {c: r.pop(c) for c in ind_cols}
        out.append(BarRow(**r, indicators=extra or None))
    return BarsResponse(symbol=symbol, adjustment=adjustment, cursor=cursor, count=len(out), bars=out)


# --------------------------------------------------------------------------- Reference

@app.get("/health", tags=["Reference"], summary="Is the API and the database up?")
def health(conn: psycopg.Connection = Conn) -> dict:
    with conn.cursor() as cur:
        cur.execute("SELECT version()")
        return {"status": "ok", "database": cur.fetchone()[0]}


@app.get("/instruments", tags=["Reference"], summary="list_instruments: symbols with bar counts and date range")
def instruments(conn: psycopg.Connection = Conn) -> list[dict]:
    return list_instruments(conn)


@app.get("/universe", tags=["Reference"], summary="load_universe: the committed universe_v1.csv")
def universe() -> list[dict]:
    from market_data.universe import load_universe

    return load_universe().to_dicts()


@app.get("/corporate-actions", tags=["Reference"], summary="get_actions: splits and dividends of a symbol")
def corporate_actions(symbol: str, as_of: date | None = Query(None, description="Only actions with ex_date <= as_of"),
                      conn: psycopg.Connection = Conn) -> list[dict]:
    return rows(get_actions(conn, symbol, as_of))


# --------------------------------------------------------------------------- Bars

@app.get("/bars", response_model=BarsResponse, tags=["Bars"], summary="get_bars: daily bars with cursor and adjustment")
def bars(
    symbol: str = Query(..., examples=["AAPL"]),
    start: date = Query(..., examples=["2020-08-25"]),
    end: date = Query(..., examples=["2020-09-04"]),
    adjustment: Adjustment = Query(Adjustment.RAW, description="raw | split | split_dividend (as of the cursor)"),
    cursor: date | None = Query(None, description="Replay cursor; nothing after it is returned. Defaults to `end`."),
    indicators: str | None = Query(None, examples=["sma:20,ema:50,simple_return"],
                                   description="Comma-separated indicator specs computed on the returned bars"),
    conn: psycopg.Connection = Conn,
) -> BarsResponse:
    eff_cursor = cursor or end
    df = get_bars(conn, symbol, start, end, max_date=eff_cursor, adjustment=adjustment)
    cols: list[str] = []
    for spec in [x.strip() for x in (indicators or "").split(",") if x.strip()]:
        ind.validate_spec(spec)
    if indicators and df.height:
        # Indicators use adjusted history up to the cursor, so warm-up bars before `start` count.
        basis_adj = Adjustment.SPLIT if adjustment is Adjustment.RAW else adjustment
        basis = get_bars(conn, symbol, date(1990, 1, 1), end, max_date=eff_cursor, adjustment=basis_adj)
        for spec in [s.strip() for s in indicators.split(",") if s.strip()]:
            col = ind.compute(basis, spec).alias(spec)
            basis = basis.with_columns(col)
            cols.append(spec)
        df = df.join(basis.select("trade_date", *cols), on="trade_date", how="left")
    return to_bar_response(df, symbol, str(adjustment), eff_cursor, cols)


# --------------------------------------------------------------------------- Adjustment (pure)

class BarIn(BaseModel):
    trade_date: date
    open: float
    high: float
    low: float
    close: float
    volume: int = 0


class ActionIn(BaseModel):
    action_type: str = Field(..., description="split | dividend")
    ex_date: date
    split_from: float | None = Field(None, description="Old shares (a 4-for-1 split: 1)")
    split_to: float | None = Field(None, description="New shares (a 4-for-1 split: 4)")
    cash_amount: float | None = Field(None, description="Dividend per share")


class AdjustRequest(BaseModel):
    bars: list[BarIn]
    actions: list[ActionIn]
    as_of: date
    mode: Adjustment = Adjustment.SPLIT

    model_config = {"json_schema_extra": {"examples": [{
        "bars": [{"trade_date": "2020-08-28", "open": 400, "high": 405, "low": 395, "close": 400, "volume": 1000},
                 {"trade_date": "2020-08-31", "open": 100, "high": 102, "low": 98, "close": 100, "volume": 4000}],
        "actions": [{"action_type": "split", "ex_date": "2020-08-31", "split_from": 1, "split_to": 4}],
        "as_of": "2020-08-31", "mode": "split"}]}}


def frame(items: list[BaseModel], schema: dict) -> pl.DataFrame:
    return pl.DataFrame([i.model_dump() for i in items], schema=schema, orient="row") if items else pl.DataFrame(schema=schema)


BAR_SCHEMA = {"trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64, "low": pl.Float64,
              "close": pl.Float64, "volume": pl.Int64}
ACTION_SCHEMA = {"action_type": pl.String, "ex_date": pl.Date, "split_from": pl.Float64,
                 "split_to": pl.Float64, "cash_amount": pl.Float64}


@app.post("/adjust/preview", response_model=BarsResponse, tags=["Adjustment"],
          summary="adjust_bars: adjust your own bars as of a date (no database)")
def adjust_preview(req: AdjustRequest) -> BarsResponse:
    df = adjust_bars(frame(req.bars, BAR_SCHEMA), frame(req.actions, ACTION_SCHEMA), req.as_of, req.mode)
    return to_bar_response(df, None, str(req.mode), req.as_of)


# --------------------------------------------------------------------------- Indicators

class ComputeRequest(BaseModel):
    closes: list[float]
    specs: list[str] = Field(..., examples=[["sma:3", "ema:3", "simple_return", "log_return", "volatility:3"]])
    model_config = {"json_schema_extra": {"examples": [{"closes": [10, 11, 12, 13], "specs": ["sma:3", "simple_return"]}]}}


@app.post("/indicators/compute", tags=["Indicators"], summary="Compute indicators on your own closes (no database)")
def indicators_compute(req: ComputeRequest) -> dict:
    n = len(req.closes)
    base = date(2000, 1, 1).toordinal()
    df = pl.DataFrame({"trade_date": [date.fromordinal(base + i) for i in range(n)], "close": req.closes})
    clean = lambda xs: [None if (v is None or not math.isfinite(v)) else v for v in xs]  # noqa: E731
    return {"closes": req.closes, "indicators": {s: clean(ind.compute(df, s).to_list()) for s in req.specs}}


@app.get("/indicators/{symbol}", response_model=BarsResponse, tags=["Indicators"],
         summary="Indicators for a stored symbol (adjusted as of the cursor)")
def indicators_symbol(symbol: str, start: date, end: date,
                      specs: str = Query("sma:20,ema:20,simple_return,volatility:20"),
                      cursor: date | None = None, adjustment: Adjustment = Adjustment.SPLIT,
                      conn: psycopg.Connection = Conn) -> BarsResponse:
    return bars(symbol, start, end, adjustment, cursor, specs, conn)


class CausalityRequest(BaseModel):
    indicator: str = Field(..., examples=["sma:5"], description="Spec, or 'leaky_centered_sma:5' to see a failing case")
    closes: list[float]
    cut_points: int = 100


@app.post("/indicators/causality-check", tags=["Indicators"],
          summary="check_truncation: is an indicator causal? (value at t unchanged when the future is cut)")
def causality_check(req: CausalityRequest) -> dict:
    n = len(req.closes)
    df = pl.DataFrame({"trade_date": [date.fromordinal(date(2000, 1, 1).toordinal() + i) for i in range(n)],
                       "close": req.closes})
    if req.indicator.startswith("leaky_centered_sma:"):  # deliberately non-causal, for demonstration
        w = int(req.indicator.split(":")[1])
        fn = lambda d: d.select(pl.col("close").rolling_mean(window_size=w, center=True)).to_series()  # noqa: E731
    else:
        fn = lambda d: ind.compute(d, req.indicator)  # noqa: E731
    bad = ind.check_truncation(fn, df, req.cut_points)
    return {"indicator": req.indicator, "causal": not bad, "violating_cut_indices": bad[:50]}


# --------------------------------------------------------------------------- Replay

SESSIONS: dict[str, ReplaySession] = {}


class SessionRequest(BaseModel):
    symbol: str = Field(..., examples=["AAPL"])
    start: date = Field(..., examples=["2020-08-20"])


class AdvanceRequest(BaseModel):
    n_sessions: int = Field(1, description="Must be >= 1 (the cursor never moves backward)")


@app.post("/replay/sessions", tags=["Replay"], summary="new_session: open a replay session (cursor = first session)")
def replay_open(req: SessionRequest, conn: psycopg.Connection = Conn) -> dict:
    s = new_session(conn, req.symbol, req.start)
    sid = uuid.uuid4().hex[:8]
    SESSIONS[sid] = s
    return {"session_id": sid, "symbol": s.symbol, "start": s.start, "cursor": s.cursor}


def _session(sid: str) -> ReplaySession:
    if sid not in SESSIONS:
        raise HTTPException(404, "unknown replay session")
    return SESSIONS[sid]


@app.get("/replay/sessions/{session_id}", tags=["Replay"], summary="Current cursor of a session")
def replay_get(session_id: str) -> dict:
    s = _session(session_id)
    return {"session_id": session_id, "symbol": s.symbol, "start": s.start, "cursor": s.cursor}


@app.post("/replay/sessions/{session_id}/advance", tags=["Replay"], summary="ReplaySession.advance: move the cursor forward")
def replay_advance(session_id: str, req: AdvanceRequest, conn: psycopg.Connection = Conn) -> dict:
    s = _session(session_id)
    return {"session_id": session_id, "cursor": s.advance(conn, req.n_sessions)}


@app.get("/replay/sessions/{session_id}/bars", response_model=BarsResponse, tags=["Replay"],
         summary="visible_bars (+ blind_view): bars up to the cursor only")
def replay_bars(session_id: str, adjustment: Adjustment = Adjustment.SPLIT,
                blind: bool = Query(False, description="Hide symbol/dates; rebase to 100"),
                conn: psycopg.Connection = Conn) -> BarsResponse:
    s = _session(session_id)
    df = visible_bars(conn, s, adjustment)
    if blind:
        return to_bar_response(blind_view(df), None, str(adjustment), None)
    return to_bar_response(df, s.symbol, str(adjustment), s.cursor)


# --------------------------------------------------------------------------- Lineage

@app.get("/lineage/{symbol}", tags=["Lineage"], summary="lineage: provider, feed, manifest hash, jobs, quality counts, caveats")
def lineage_endpoint(symbol: str, cursor: date | None = None, conn: psycopg.Connection = Conn) -> dict:
    return build_lineage(conn, symbol, cursor)


# --------------------------------------------------------------------------- Data quality

@app.get("/quality/runs", tags=["Data quality"], summary="Stored quality runs with flag counts")
def quality_runs(conn: psycopg.Connection = Conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT run_id, min(created_at), count(*) FROM market.data_quality_result GROUP BY run_id "
                    "ORDER BY min(created_at) DESC LIMIT 50")
        return [{"run_id": r[0], "created_at": r[1], "flags": r[2]} for r in cur.fetchall()]


@app.get("/quality/results", tags=["Data quality"], summary="Stored quality flags (filter by run, rule, symbol)")
def quality_results(run_id: str | None = None, rule: str | None = None, symbol: str | None = None,
                    limit: int = Query(100, le=1000), conn: psycopg.Connection = Conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT r.run_id, r.rule, r.severity, i.symbol, r.trade_date, r.detail FROM market.data_quality_result r "
            "JOIN market.instrument i USING (instrument_id) WHERE (%s::text IS NULL OR r.run_id = %s) "
            "AND (%s::text IS NULL OR r.rule = %s) AND (%s::text IS NULL OR i.symbol = %s) "
            "AND r.run_id = COALESCE(%s, (SELECT run_id FROM market.data_quality_result ORDER BY result_id DESC LIMIT 1)) "
            "ORDER BY i.symbol, r.trade_date LIMIT %s", (run_id, run_id, rule, rule, symbol, symbol, run_id, limit))
        return [dict(run_id=r[0], rule=r[1], severity=r[2], symbol=r[3], trade_date=r[4], detail=r[5]) for r in cur.fetchall()]


class RuleCheckRequest(BaseModel):
    rule: str = Field(..., description=f"One of {q.RULES}")
    bars: list[dict[str, Any]] = Field(..., description="Rows with symbol, trade_date, open, high, low, close, volume")
    threshold: float = q.LARGE_MOVE_THRESHOLD
    splits: list[dict[str, Any]] = Field(default_factory=list, description="Rows with symbol, ex_date (for large_move)")
    model_config = {"json_schema_extra": {"examples": [{
        "rule": "large_move", "threshold": 0.4,
        "bars": [{"symbol": "A", "trade_date": "2020-08-28", "open": 400, "high": 405, "low": 395, "close": 400, "volume": 1},
                 {"symbol": "A", "trade_date": "2020-08-31", "open": 100, "high": 102, "low": 98, "close": 100, "volume": 1}],
        "splits": [{"symbol": "A", "ex_date": "2020-08-31"}]}]}}


@app.post("/quality/rules/check", tags=["Data quality"], summary="Run one quality rule on your own bars (no database)")
def quality_rule_check(req: RuleCheckRequest) -> dict:
    if req.rule not in q.RULES:
        raise ValueError(f"unknown rule; choose from {q.RULES}")
    schema = {"symbol": pl.String, "trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64,
              "low": pl.Float64, "close": pl.Float64, "volume": pl.Int64}
    parse = lambda r: {**r, "trade_date": date.fromisoformat(str(r["trade_date"]))}  # noqa: E731
    df = pl.DataFrame([parse(r) for r in req.bars], schema=schema)
    splits = pl.DataFrame([{"symbol": r["symbol"], "ex_date": date.fromisoformat(str(r["ex_date"]))} for r in req.splits],
                          schema={"symbol": pl.String, "ex_date": pl.Date})
    sessions = q.xnys_sessions(df["trade_date"].min(), df["trade_date"].max()) if df.height else []
    fn = {"duplicate_key": q.duplicate_key, "ohlc_consistency": q.ohlc_consistency,
          "non_positive_price": q.non_positive_price, "negative_volume": q.negative_volume,
          "zero_volume_day": q.zero_volume_day, "stale_price": q.stale_price}.get(req.rule)
    if req.rule == "large_move":
        out = q.large_move(df, threshold=req.threshold, splits=splits, sessions=sessions)
    elif req.rule == "missing_session":
        out = q.missing_session(df, sessions)
    else:
        out = fn(df)
    return {"rule": req.rule, "flagged": [{"symbol": r["symbol"], "trade_date": r["trade_date"],
                                           "detail": json.loads(r["detail"])} for r in out.iter_rows(named=True)]}


@app.post("/quality/run", tags=["Data quality"], summary="run_quality: check all loaded bars and write a report (writes results)")
def quality_run(threshold: float = q.LARGE_MOVE_THRESHOLD, conn: psycopg.Connection = Conn) -> dict:
    rep = q.run_quality(conn, threshold=threshold)
    return {k: rep[k] for k in ("run_id", "bars_checked", "symbols", "totals_per_rule",
                                "missing_session_classification", "seconds")}


# --------------------------------------------------------------------------- Ingestion

@app.get("/ingestion/jobs", tags=["Ingestion"], summary="Loader job history with reconciliation")
def ingestion_jobs(limit: int = Query(50, le=500), status: str | None = None,
                   conn: psycopg.Connection = Conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT ingestion_job_id, kind, file_name, status, started_at, rows_read, rows_inserted, rows_updated, "
                    "rows_unchanged, rows_rejected, error FROM market.ingestion_job WHERE (%s::text IS NULL OR status = %s) "
                    "ORDER BY ingestion_job_id DESC LIMIT %s", (status, status, limit))
        return [dict(job_id=r[0], kind=r[1], file=r[2], status=r[3], started_at=r[4], read=r[5], inserted=r[6],
                     updated=r[7], unchanged=r[8], rejected=r[9], reconciles=r[5] == r[6] + r[7] + r[8] + r[9],
                     error=r[10]) for r in cur.fetchall()]


@app.get("/ingestion/quarantine", tags=["Ingestion"], summary="Rejected rows with reasons")
def quarantine(limit: int = Query(100, le=1000), conn: psycopg.Connection = Conn) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT ingestion_job_id, symbol, trade_date, reason, raw_record FROM market.bar_quarantine "
                    "ORDER BY quarantine_id DESC LIMIT %s", (limit,))
        return [dict(job_id=r[0], symbol=r[1], trade_date=r[2], reason=r[3], raw_record=r[4]) for r in cur.fetchall()]


@app.get("/ingestion/raw-files", tags=["Ingestion"], summary="Raw files on disk with their manifests")
def raw_file_list() -> list[dict]:
    from market_data.manifest import MANIFEST_SUFFIX, read_manifest

    out = []
    for mp in sorted((config.DATA_DIR / "raw").rglob("*" + MANIFEST_SUFFIX)):
        m = read_manifest(mp.with_name(mp.name[: -len(MANIFEST_SUFFIX)]))
        out.append({"file": m["file"], "provider": m["provider"], "retrieved_at": m["retrieved_at"],
                    "row_count": m["row_count"], "sha256": m["file_sha256"]})
    return out


@app.post("/ingestion/verify", tags=["Ingestion"], summary="verify_tree: check every raw file against its manifest hash")
def verify() -> dict:
    from market_data.manifest import verify_tree

    res = verify_tree(config.DATA_DIR / "raw")
    return {"ok": sum(1 for r in res if r[1]), "failed": [{"file": str(r[0].name), "message": r[2]} for r in res if not r[1]]}


class DownloadRequest(BaseModel):
    symbols: list[str] | None = Field(None, description="Default: whole universe")
    start: date = date.fromisoformat(config.DEFAULT_START)
    end: date = date.fromisoformat(config.DEFAULT_END)
    feed: str = "iex"
    force: bool = False


@app.post("/ingestion/download", tags=["Ingestion"],
          summary="download_universe: fetch raw bars + corporate actions from Alpaca (needs API keys in .env)")
def download(req: DownloadRequest) -> dict:
    from market_data.download import DownloadError, download_universe
    from market_data.universe import symbols

    try:
        return download_universe(req.symbols or symbols(), req.start.isoformat(), req.end.isoformat(),
                                 feed=req.feed, force=req.force)
    except DownloadError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/ingestion/load", tags=["Ingestion"], summary="load_universe_files: idempotent load of the latest raw files (writes)")
def load(conn: psycopg.Connection = Conn) -> dict:
    from market_data.load import load_universe_files
    from market_data.universe import load_universe

    res = load_universe_files(conn, load_universe())
    keys = ("read", "inserted", "updated", "unchanged", "rejected")
    return {"files": len(res), **{k: sum(r.get(k, 0) for r in res) for k in keys}}


# --------------------------------------------------------------------------- Benchmark

@app.get("/benchmark/results", tags=["Benchmark"], summary="Stored benchmark JSON (dataset, load, warm/cold runs, index experiment)")
def benchmark_results() -> dict:
    out: dict = {}
    d = config.REPORT_DIR / "bench"
    for p in sorted(d.glob("*.json")) if d.exists() else []:
        out[p.stem] = json.loads(p.read_text())
    return out


def openapi_schema() -> dict:
    return app.openapi()
