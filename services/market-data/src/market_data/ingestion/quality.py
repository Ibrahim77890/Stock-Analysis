"""Data-quality rules, calendar-aware gap classification and report generation.

Every rule is a pure function: it takes a DataFrame of bars (columns: symbol,
trade_date, open, high, low, close, volume) and returns the flagged rows with
columns [symbol, trade_date, detail] where `detail` is a JSON string. Rules never
modify data; they only describe it.
"""

import bisect
import json
import time
import uuid
from datetime import date, timedelta
from pathlib import Path

import polars as pl
import psycopg

from market_data.core import config

LARGE_MOVE_THRESHOLD = 0.40
STALE_MIN_RUN = 5

SEVERITY = {
    "duplicate_key": "error", "ohlc_consistency": "error", "non_positive_price": "error",
    "negative_volume": "error", "zero_volume_day": "info", "large_move": "warning",
    "stale_price": "warning", "missing_session": "warning",
}
RULES = list(SEVERITY)
FLAG_SCHEMA = {"symbol": pl.String, "trade_date": pl.Date, "detail": pl.String}


def _flags(df: pl.DataFrame, detail: pl.Expr | None = None) -> pl.DataFrame:
    det = detail if detail is not None else pl.lit("{}")
    return df.select("symbol", "trade_date", det.alias("detail")).sort("symbol", "trade_date")


def _empty() -> pl.DataFrame:
    return pl.DataFrame(schema=FLAG_SCHEMA)


def duplicate_key(bars: pl.DataFrame) -> pl.DataFrame:
    dup = bars.filter(pl.len().over("symbol", "trade_date") > 1)
    return _flags(dup.unique(["symbol", "trade_date"]))


def ohlc_consistency(bars: pl.DataFrame) -> pl.DataFrame:
    o, h, l, c = (pl.col(x) for x in ("open", "high", "low", "close"))
    bad = bars.filter((h < pl.max_horizontal(o, c, l)) | (l > pl.min_horizontal(o, c, h)))
    return _flags(bad)


def non_positive_price(bars: pl.DataFrame) -> pl.DataFrame:
    bad = bars.filter(pl.any_horizontal(pl.col("open", "high", "low", "close") <= 0))
    return _flags(bad)


def negative_volume(bars: pl.DataFrame) -> pl.DataFrame:
    return _flags(bars.filter(pl.col("volume") < 0))


def zero_volume_day(bars: pl.DataFrame) -> pl.DataFrame:
    return _flags(bars.filter(pl.col("volume") == 0))


def _near_dates(ex_dates: list[date], sessions: list[date]) -> set[date]:
    """Each ex_date plus the session before and after it."""
    out: set[date] = set()
    for d in ex_dates:
        i = bisect.bisect_left(sessions, d)
        for j in (i - 1, i, i + 1):
            if 0 <= j < len(sessions):
                out.add(sessions[j])
        out.add(d)
    return out


def large_move(
    bars: pl.DataFrame, *, threshold: float = LARGE_MOVE_THRESHOLD,
    splits: pl.DataFrame | None = None, sessions: list[date] | None = None,
) -> pl.DataFrame:
    """|close-to-close return| > threshold. `splits` has columns symbol, ex_date.

    detail = {"return": r, "explained_by_split": bool}; flagged, never deleted.
    """
    df = bars.sort("symbol", "trade_date").with_columns(
        (pl.col("close") / pl.col("close").shift(1).over("symbol") - 1).alias("ret")
    )
    moves = df.filter(pl.col("ret").abs() > threshold)
    if moves.height == 0:
        return _empty()
    explained: dict[str, set[date]] = {}
    if splits is not None and splits.height:
        sess = sessions or sorted(bars["trade_date"].unique().to_list())
        for sym, grp in splits.group_by("symbol"):
            explained[sym[0]] = _near_dates(grp["ex_date"].to_list(), sess)
    rows = []
    for r in moves.iter_rows(named=True):
        ok = r["trade_date"] in explained.get(r["symbol"], set())
        rows.append((r["symbol"], r["trade_date"],
                     json.dumps({"return": round(r["ret"], 6), "explained_by_split": ok}, sort_keys=True)))
    return pl.DataFrame(rows, schema=FLAG_SCHEMA, orient="row").sort("symbol", "trade_date")


def stale_price(bars: pl.DataFrame, *, min_run: int = STALE_MIN_RUN) -> pl.DataFrame:
    """Flag the last bar of each run of >= min_run consecutive bars with identical OHLC."""
    df = bars.sort("symbol", "trade_date").with_columns(
        (pl.struct("open", "high", "low", "close") != pl.struct("open", "high", "low", "close").shift(1))
        .fill_null(True).over("symbol").alias("_chg")
    )
    df = df.with_columns(pl.col("_chg").cum_sum().over("symbol").alias("_run"))
    runs = df.group_by("symbol", "_run").agg(
        pl.len().alias("n"), pl.col("trade_date").last().alias("trade_date"),
        pl.col("trade_date").first().alias("first_date"),
    ).filter(pl.col("n") >= min_run)
    if runs.height == 0:
        return _empty()
    return runs.select(
        "symbol", "trade_date",
        pl.format('{{"first_date": "{}", "run_length": {}}}', pl.col("first_date"), pl.col("n")).alias("detail"),
    ).sort("symbol", "trade_date")


def missing_session(
    bars: pl.DataFrame, sessions: list[date], *, range_start: date | None = None,
    range_end: date | None = None,
) -> pl.DataFrame:
    """Expected exchange sessions with no bar, classified per symbol.

    classification: before_first_bar | after_last_bar (outside the instrument's own
    data range, informational) | provider_gap (inside the range, a real hole).
    """
    rows = []
    lo = range_start or min(sessions)
    hi = range_end or max(sessions)
    expected = [d for d in sessions if lo <= d <= hi]
    for sym, grp in bars.group_by("symbol", maintain_order=True):
        present = set(grp["trade_date"].to_list())
        if not present:
            continue
        first, last = min(present), max(present)
        for d in expected:
            if d in present:
                continue
            cls = "before_first_bar" if d < first else "after_last_bar" if d > last else "provider_gap"
            rows.append((sym[0], d, json.dumps({"classification": cls})))
    if not rows:
        return _empty()
    return pl.DataFrame(rows, schema=FLAG_SCHEMA, orient="row").sort("symbol", "trade_date")


def run_rules(
    bars: pl.DataFrame, splits: pl.DataFrame, sessions: list[date],
    *, range_start: date | None = None, range_end: date | None = None,
    threshold: float = LARGE_MOVE_THRESHOLD,
) -> dict[str, pl.DataFrame]:
    return {
        "duplicate_key": duplicate_key(bars),
        "ohlc_consistency": ohlc_consistency(bars),
        "non_positive_price": non_positive_price(bars),
        "negative_volume": negative_volume(bars),
        "zero_volume_day": zero_volume_day(bars),
        "large_move": large_move(bars, threshold=threshold, splits=splits, sessions=sessions),
        "stale_price": stale_price(bars),
        "missing_session": missing_session(bars, sessions, range_start=range_start, range_end=range_end),
    }


# --------------------------------------------------------------------------- calendar + DB

def xnys_sessions(start: date, end: date) -> list[date]:
    import exchange_calendars as xcals

    cal = xcals.get_calendar("XNYS")
    s = max(pd_ts(start), cal.first_session)
    e = min(pd_ts(end), cal.last_session)
    return [t.date() for t in cal.sessions_in_range(s, e)]


def pd_ts(d: date):
    import pandas as pd

    return pd.Timestamp(d)


def run_quality(conn: psycopg.Connection, *, source: str = config.SOURCE,
                threshold: float = LARGE_MOVE_THRESHOLD, report_dir: Path | None = None) -> dict:
    t0 = time.perf_counter()
    run_id = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + "-" + uuid.uuid4().hex[:6]
    with conn.cursor() as cur:
        cur.execute(
            "SELECT i.symbol, b.instrument_id, b.trade_date, b.open::float8, b.high::float8, "
            "b.low::float8, b.close::float8, b.volume FROM market.bar_daily b "
            "JOIN market.instrument i USING (instrument_id) WHERE b.source = %s "
            "ORDER BY i.symbol, b.trade_date", (source,))
        rows = cur.fetchall()
        cur.execute(
            "SELECT i.symbol, a.ex_date FROM market.corporate_action a "
            "JOIN market.instrument i USING (instrument_id) "
            "WHERE a.action_type = 'split' AND a.source = %s", (source,))
        split_rows = cur.fetchall()
    ids = {r[0]: r[1] for r in rows}
    bars = pl.DataFrame(
        [r[:1] + r[2:] for r in rows],
        schema={"symbol": pl.String, "trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64,
                "low": pl.Float64, "close": pl.Float64, "volume": pl.Int64}, orient="row")
    splits = pl.DataFrame(split_rows, schema={"symbol": pl.String, "ex_date": pl.Date}, orient="row")
    if bars.height == 0:
        raise RuntimeError("no bars loaded; nothing to check")

    start, end = bars["trade_date"].min(), bars["trade_date"].max()
    sessions = xnys_sessions(start, end)
    results = run_rules(bars, splits, sessions, range_start=start, range_end=end, threshold=threshold)

    with conn.cursor() as cur:
        with cur.copy("COPY market.data_quality_result (run_id, rule, severity, instrument_id, "
                      "trade_date, detail) FROM STDIN") as cp:
            for rule, flagged in results.items():
                for r in flagged.iter_rows(named=True):
                    cp.write_row((run_id, rule, SEVERITY[rule], ids[r["symbol"]], r["trade_date"], r["detail"]))
        cur.execute(
            "SELECT DISTINCT ON (kind, file_name) kind, file_name, status, rows_read, rows_inserted, "
            "rows_updated, rows_unchanged, rows_rejected FROM market.ingestion_job "
            "ORDER BY kind, file_name, ingestion_job_id DESC")
        jobs = cur.fetchall()
    conn.commit()

    report = build_report(run_id, results, bars, jobs, threshold)
    out = (report_dir or config.REPORT_DIR)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"quality-report-{run_id}.json").write_text(json.dumps(report, indent=2, sort_keys=True))
    (out / f"quality-report-{run_id}.md").write_text(render_markdown(report))
    report["seconds"] = round(time.perf_counter() - t0, 2)
    return report


def build_report(run_id: str, results: dict[str, pl.DataFrame], bars: pl.DataFrame,
                 jobs: list, threshold: float) -> dict:
    per_rule = {rule: df.height for rule, df in results.items()}
    per_symbol: dict[str, dict[str, int]] = {}
    examples: dict[str, list] = {}
    for rule, df in results.items():
        for (sym,), grp in df.group_by("symbol"):
            per_symbol.setdefault(sym, {})[rule] = grp.height
        examples[rule] = [
            {"symbol": r["symbol"], "trade_date": str(r["trade_date"]), "detail": json.loads(r["detail"])}
            for r in df.head(5).iter_rows(named=True)
        ]
    gaps = results["missing_session"]
    classes: dict[str, int] = {}
    for d in gaps["detail"].to_list():
        c = json.loads(d)["classification"]
        classes[c] = classes.get(c, 0) + 1
    recon = [
        {"kind": j[0], "file": j[1], "status": j[2], "read": j[3], "inserted": j[4], "updated": j[5],
         "unchanged": j[6], "rejected": j[7], "reconciles": j[3] == j[4] + j[5] + j[6] + j[7]}
        for j in jobs
    ]
    return {
        "run_id": run_id, "large_move_threshold": threshold, "bars_checked": bars.height,
        "symbols": bars["symbol"].n_unique(), "totals_per_rule": per_rule,
        "missing_session_classification": dict(sorted(classes.items())),
        "per_symbol": {k: per_symbol[k] for k in sorted(per_symbol)},
        "examples": examples, "reconciliation": recon,
    }


def render_markdown(rep: dict) -> str:
    lines = [f"# Data-quality report `{rep['run_id']}`", "",
             f"Bars checked: {rep['bars_checked']:,} across {rep['symbols']} symbols. "
             f"`large_move` threshold: {rep['large_move_threshold']:.0%}.", "",
             "## Totals per rule", "", "| Rule | Severity | Flagged |", "|---|---|---|"]
    for rule, n in rep["totals_per_rule"].items():
        lines.append(f"| {rule} | {SEVERITY[rule]} | {n:,} |")
    lines += ["", "Missing sessions by classification: "
              + (", ".join(f"{k}={v:,}" for k, v in rep["missing_session_classification"].items()) or "none"),
              "", "## Per symbol", "", "| Symbol | " + " | ".join(RULES) + " |",
              "|---|" + "---|" * len(RULES)]
    for sym, counts in rep["per_symbol"].items():
        lines.append(f"| {sym} | " + " | ".join(str(counts.get(r, 0)) for r in RULES) + " |")
    lines += ["", "## Examples (up to 5 per rule)"]
    for rule, ex in rep["examples"].items():
        lines += ["", f"### {rule}"]
        lines += [f"- {e['symbol']} {e['trade_date']} {json.dumps(e['detail'], sort_keys=True)}" for e in ex] or ["- none"]
    lines += ["", "## Ingestion reconciliation (latest job per file)", "",
              "| Kind | File | Status | Read | Inserted | Updated | Unchanged | Rejected | OK |",
              "|---|---|---|---|---|---|---|---|---|"]
    for j in rep["reconciliation"]:
        lines.append(f"| {j['kind']} | {j['file']} | {j['status']} | {j['read']} | {j['inserted']} | "
                     f"{j['updated']} | {j['unchanged']} | {j['rejected']} | {'yes' if j['reconciles'] else 'NO'} |")
    return "\n".join(lines) + "\n"
