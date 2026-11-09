"""Idempotent loader: raw Parquet + manifest -> market.* tables, with quarantine.

Guarantees
* The manifest hash is verified before the file is read.
* Invalid rows go to market.bar_quarantine with a reason; nothing is dropped silently.
* Re-loading identical data inserts and updates nothing (rows_unchanged counts them).
* Data and the job's final status are committed in one transaction; on any error the
  data is rolled back and the job is recorded as failed.
* rows_read = inserted + updated + unchanged + rejected, enforced on every job.
"""

import json
from pathlib import Path
from typing import Callable

import polars as pl
import psycopg

from market_data.core import config
from market_data.core.manifest import read_manifest, verify_file

BATCH_SIZE = 10_000
PRICE_COLS = ["open", "high", "low", "close"]

BAR_REJECT_REASONS = (
    "unknown_symbol", "null_value", "non_positive_price", "high_below_ohlc",
    "low_above_ohlc", "negative_volume", "duplicate_key",
)


class LoadError(RuntimeError):
    pass


# --------------------------------------------------------------------------- pure validation

def normalise_bars(raw: pl.DataFrame, default_symbol: str | None = None) -> pl.DataFrame:
    """Raw Alpaca columns -> normalised columns with explicit types.

    Output: symbol, trade_date, open, high, low, close, volume, trade_count, vwap.
    Values are only cast/renamed here; invalid values are kept for validate_bars.
    """
    df = raw
    if "symbol" not in df.columns:
        if default_symbol is None:
            raise LoadError("raw bars have no symbol column and no default symbol was given")
        df = df.with_columns(pl.lit(default_symbol).alias("symbol"))
    ts = pl.col("t").str.to_datetime(time_zone="UTC", strict=False)
    return df.select(
        pl.col("symbol").cast(pl.String),
        ts.dt.convert_time_zone("America/New_York").dt.date().alias("trade_date"),
        pl.col("o").cast(pl.Float64).round(6).alias("open"),
        pl.col("h").cast(pl.Float64).round(6).alias("high"),
        pl.col("l").cast(pl.Float64).round(6).alias("low"),
        pl.col("c").cast(pl.Float64).round(6).alias("close"),
        pl.col("v").cast(pl.Int64).alias("volume"),
        (pl.col("n").cast(pl.Int64) if "n" in df.columns else pl.lit(None, pl.Int64)).alias("trade_count"),
        (pl.col("vw").cast(pl.Float64).round(6) if "vw" in df.columns else pl.lit(None, pl.Float64)).alias("vwap"),
    )


def _tiingo_dates(raw: pl.DataFrame) -> pl.Expr:
    """Tiingo's `date` is already the trading date at midnight UTC: take the date part, no time-zone shift."""
    return pl.col("date").cast(pl.String).str.slice(0, 10).str.to_date(strict=False)


def normalise_tiingo_bars(raw: pl.DataFrame, symbol: str) -> pl.DataFrame:
    """Raw Tiingo records -> the same normalised columns as normalise_bars.

    Only the raw fields open/high/low/close/volume are read. Every adj* field is ignored on purpose
    (ADR 0013): adjustment is computed as of a date from raw prices and actions.
    """
    return raw.select(
        pl.lit(symbol).alias("symbol"),
        _tiingo_dates(raw).alias("trade_date"),
        pl.col("open").cast(pl.Float64).round(6).alias("open"),
        pl.col("high").cast(pl.Float64).round(6).alias("high"),
        pl.col("low").cast(pl.Float64).round(6).alias("low"),
        pl.col("close").cast(pl.Float64).round(6).alias("close"),
        pl.col("volume").cast(pl.Int64).alias("volume"),
        pl.lit(None, pl.Int64).alias("trade_count"),
        pl.lit(None, pl.Float64).alias("vwap"),
    )


def normalise_tiingo_actions(raw: pl.DataFrame, symbol: str) -> pl.DataFrame:
    """divCash > 0 -> dividend; splitFactor != 1 -> split (from 1 to splitFactor). Same columns as normalise_actions."""
    div = raw.filter(pl.col("divCash").fill_null(0.0) > 0).select(
        pl.lit(symbol).alias("symbol"), pl.lit("dividend").alias("action_type"),
        _tiingo_dates(raw).alias("ex_date"),
        pl.lit(None, pl.Float64).alias("split_from"), pl.lit(None, pl.Float64).alias("split_to"),
        pl.col("divCash").cast(pl.Float64).alias("cash_amount"))
    spl = raw.filter(pl.col("splitFactor").fill_null(1.0) != 1.0).select(
        pl.lit(symbol).alias("symbol"), pl.lit("split").alias("action_type"),
        _tiingo_dates(raw).alias("ex_date"),
        pl.lit(1.0).alias("split_from"), pl.col("splitFactor").cast(pl.Float64).alias("split_to"),
        pl.lit(None, pl.Float64).alias("cash_amount"))
    return pl.concat([spl, div]) if (spl.height or div.height) else div


def validate_bars(df: pl.DataFrame, known_symbols: set[str]) -> tuple[pl.DataFrame, pl.DataFrame]:
    """Split normalised bars into (valid, rejected). Rejected has a `reason` column.

    The hard rules mirror the CHECK constraints of market.bar_daily.
    """
    o, h, l, c, v = (pl.col(x) for x in ("open", "high", "low", "close", "volume"))
    reason = (
        pl.when(~pl.col("symbol").is_in(list(known_symbols))).then(pl.lit("unknown_symbol"))
        .when(pl.any_horizontal(pl.col("trade_date", "open", "high", "low", "close", "volume").is_null()))
        .then(pl.lit("null_value"))
        .when((o <= 0) | (h <= 0) | (l <= 0) | (c <= 0)).then(pl.lit("non_positive_price"))
        .when(h < pl.max_horizontal(o, c, l)).then(pl.lit("high_below_ohlc"))
        .when(l > pl.min_horizontal(o, c, h)).then(pl.lit("low_above_ohlc"))
        .when(v < 0).then(pl.lit("negative_volume"))
        .otherwise(None)
    )
    df = df.with_columns(reason.alias("reason")).with_row_index("_i")
    # Duplicate keys inside one file: first occurrence wins, later ones are rejected.
    ok = df.filter(pl.col("reason").is_null()).with_columns(
        (pl.int_range(pl.len()).over(["symbol", "trade_date"]) > 0).alias("is_dup")
    )
    dup_idx = ok.filter(pl.col("is_dup"))["_i"]
    df = df.with_columns(
        pl.when(pl.col("_i").is_in(dup_idx.implode())).then(pl.lit("duplicate_key"))
        .otherwise(pl.col("reason")).alias("reason")
    )
    valid = df.filter(pl.col("reason").is_null()).drop("_i", "reason")
    rejected = df.filter(pl.col("reason").is_not_null()).drop("_i")
    return valid, rejected


def normalise_actions(raw: pl.DataFrame) -> pl.DataFrame:
    return raw.select(
        pl.col("symbol").cast(pl.String),
        pl.when(pl.col("action_type").str.contains("split")).then(pl.lit("split"))
        .when(pl.col("action_type") == "cash_dividend").then(pl.lit("dividend"))
        .otherwise(pl.col("action_type")).alias("action_type"),
        pl.col("ex_date").str.to_date(strict=False).alias("ex_date"),
        pl.col("old_rate").cast(pl.Float64).alias("split_from"),
        pl.col("new_rate").cast(pl.Float64).alias("split_to"),
        pl.col("rate").cast(pl.Float64).alias("cash_amount"),
    )


def merge_same_day_dividends(df: pl.DataFrame) -> pl.DataFrame:
    """Several cash dividends can share one ex-date (regular + special); store their sum."""
    div = df.filter(pl.col("action_type") == "dividend")
    keep = df.filter(pl.col("action_type") != "dividend")
    merged = div.group_by("symbol", "action_type", "ex_date", maintain_order=True).agg(
        pl.col("split_from").first(), pl.col("split_to").first(), pl.col("cash_amount").sum()
    )
    return pl.concat([keep, merged.select(keep.columns)])


def validate_actions(df: pl.DataFrame, known_symbols: set[str]) -> tuple[pl.DataFrame, pl.DataFrame]:
    reason = (
        pl.when(~pl.col("symbol").is_in(list(known_symbols))).then(pl.lit("unknown_symbol"))
        .when(pl.col("ex_date").is_null()).then(pl.lit("null_value"))
        .when(~pl.col("action_type").is_in(["split", "dividend"])).then(pl.lit("unknown_action_type"))
        .when((pl.col("action_type") == "split")
              & ~((pl.col("split_from") > 0) & (pl.col("split_to") > 0))).then(pl.lit("invalid_split_ratio"))
        .when((pl.col("action_type") == "dividend")
              & ~(pl.col("cash_amount") >= 0)).then(pl.lit("invalid_dividend"))
        .otherwise(None)
    )
    df = df.with_columns(reason.alias("reason")).with_row_index("_i")
    first = df.filter(pl.col("reason").is_null()).with_columns(
        (pl.int_range(pl.len()).over(["symbol", "action_type", "ex_date"]) > 0).alias("is_dup")
    )
    dup_idx = first.filter(pl.col("is_dup"))["_i"]
    df = df.with_columns(
        pl.when(pl.col("_i").is_in(dup_idx.implode())).then(pl.lit("duplicate_key"))
        .otherwise(pl.col("reason")).alias("reason")
    )
    valid = df.filter(pl.col("reason").is_null()).drop("_i", "reason")
    rejected = df.filter(pl.col("reason").is_not_null()).drop("_i")
    return valid, rejected


# --------------------------------------------------------------------------- database helpers

def upsert_instruments(conn: psycopg.Connection, universe: pl.DataFrame) -> int:
    """Insert universe symbols (idempotent). Returns number of newly inserted instruments."""
    n = 0
    with conn.cursor() as cur:
        for r in universe.iter_rows(named=True):
            cur.execute(
                "INSERT INTO market.instrument (symbol, name, asset_type, sector) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT (symbol) DO NOTHING",
                (r["symbol"], r["name"], r["type"], r["sector"]),
            )
            n += cur.rowcount
    conn.commit()
    return n


def instrument_ids(conn: psycopg.Connection) -> dict[str, int]:
    with conn.cursor() as cur:
        cur.execute("SELECT symbol, instrument_id FROM market.instrument")
        return dict(cur.fetchall())


def _start_job(conn, kind: str, source: str, raw_file: Path, sha: str) -> int:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO market.ingestion_job (kind, source, file_name, file_sha256, status) "
            "VALUES (%s, %s, %s, %s, 'running') RETURNING ingestion_job_id",
            (kind, source, raw_file.name, sha),
        )
        job_id = cur.fetchone()[0]
    conn.commit()
    return job_id


def _fail_job(conn, job_id: int, error: str) -> None:
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE market.ingestion_job SET status='failed', finished_at=now(), error=%s "
            "WHERE ingestion_job_id=%s", (error[:2000], job_id),
        )
    conn.commit()


def _quarantine(cur, job_id: int, rejected: pl.DataFrame, key_cols: list[str]) -> None:
    if rejected.height == 0:
        return
    with cur.copy(
        "COPY market.bar_quarantine (ingestion_job_id, symbol, trade_date, reason, raw_record) FROM STDIN"
    ) as cp:
        for r in rejected.iter_rows(named=True):
            rec = {k: v for k, v in r.items() if k != "reason"}
            date_col = "trade_date" if "trade_date" in r else "ex_date"
            cp.write_row((job_id, r.get("symbol"), r.get(date_col), r["reason"],
                          json.dumps(rec, default=str)))


def _run_job(
    conn: psycopg.Connection, kind: str, source: str, raw_file: Path, sha: str,
    work: Callable[[psycopg.Cursor, int], dict],
) -> dict:
    """Run `work(cur, job_id)` in one transaction and record the job outcome."""
    job_id = _start_job(conn, kind, source, raw_file, sha)
    try:
        with conn.cursor() as cur:
            counts = work(cur, job_id)
            total = counts["inserted"] + counts["updated"] + counts["unchanged"] + counts["rejected"]
            if total != counts["read"]:
                raise LoadError(f"reconciliation failed: read={counts['read']} but parts sum to {total}")
            cur.execute(
                "UPDATE market.ingestion_job SET status='succeeded', finished_at=now(), "
                "rows_read=%s, rows_inserted=%s, rows_updated=%s, rows_unchanged=%s, rows_rejected=%s "
                "WHERE ingestion_job_id=%s",
                (counts["read"], counts["inserted"], counts["updated"], counts["unchanged"],
                 counts["rejected"], job_id),
            )
        conn.commit()
    except BaseException as exc:
        _fail_job(conn, job_id, f"{type(exc).__name__}: {exc}")
        raise
    return {"job_id": job_id, **counts}


# --------------------------------------------------------------------------- loaders

def load_bars(
    conn: psycopg.Connection, raw_file: Path, *, batch_size: int = BATCH_SIZE,
    fail_after_batches: int | None = None,
) -> dict:
    """Load one raw bars file. `fail_after_batches` is a test hook that raises mid-load."""
    ok, msg = verify_file(raw_file)
    if not ok:
        raise LoadError(f"refusing to load: {msg}")
    manifest = read_manifest(raw_file)
    source = manifest["provider"]
    default_symbol = manifest["parameters"].get("symbol")
    ids = instrument_ids(conn)

    raw = pl.read_parquet(raw_file)
    norm = normalise_tiingo_bars(raw, default_symbol) if source == "tiingo" else normalise_bars(raw, default_symbol)
    valid, rejected = validate_bars(norm, set(ids))

    def work(cur: psycopg.Cursor, job_id: int) -> dict:
        _quarantine(cur, job_id, rejected, ["symbol", "trade_date"])
        cur.execute(
            "CREATE TEMP TABLE IF NOT EXISTS stage_bar (LIKE market.bar_daily "
            "INCLUDING DEFAULTS) ON COMMIT DROP"
        )
        counts = {"read": raw.height, "inserted": 0, "updated": 0, "unchanged": 0,
                  "rejected": rejected.height}
        staged = valid.with_columns(pl.col("symbol").replace_strict(ids, return_dtype=pl.Int64)
                                    .alias("instrument_id"))
        for b, start in enumerate(range(0, staged.height, batch_size)):
            if fail_after_batches is not None and b >= fail_after_batches:
                raise LoadError("simulated failure (test hook)")
            batch = staged.slice(start, batch_size)
            cur.execute("TRUNCATE stage_bar")
            with cur.copy(
                "COPY stage_bar (instrument_id, trade_date, source, open, high, low, close, "
                "volume, trade_count, vwap, ingestion_job_id) FROM STDIN"
            ) as cp:
                for r in batch.iter_rows(named=True):
                    cp.write_row((r["instrument_id"], r["trade_date"], source, r["open"], r["high"],
                                  r["low"], r["close"], r["volume"], r["trade_count"], r["vwap"], job_id))
            cur.execute(
                "INSERT INTO market.bar_daily AS t (instrument_id, trade_date, source, open, high, low, "
                "close, volume, trade_count, vwap, ingestion_job_id) "
                "SELECT instrument_id, trade_date, source, open, high, low, close, volume, trade_count, "
                "vwap, ingestion_job_id FROM stage_bar "
                "ON CONFLICT (instrument_id, trade_date, source) DO UPDATE SET "
                "open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, close=EXCLUDED.close, "
                "volume=EXCLUDED.volume, trade_count=EXCLUDED.trade_count, vwap=EXCLUDED.vwap, "
                "ingestion_job_id=EXCLUDED.ingestion_job_id, loaded_at=now() "
                "WHERE (t.open, t.high, t.low, t.close, t.volume, t.trade_count, t.vwap) "
                "IS DISTINCT FROM (EXCLUDED.open, EXCLUDED.high, EXCLUDED.low, EXCLUDED.close, "
                "EXCLUDED.volume, EXCLUDED.trade_count, EXCLUDED.vwap) "
                "RETURNING (xmax = 0) AS was_inserted"
            )
            flags = [r[0] for r in cur.fetchall()]
            ins = sum(flags)
            counts["inserted"] += ins
            counts["updated"] += len(flags) - ins
            counts["unchanged"] += batch.height - len(flags)
        return counts

    return _run_job(conn, "bars", source, raw_file, manifest["file_sha256"], work)


def load_corporate_actions(conn: psycopg.Connection, raw_file: Path) -> dict:
    ok, msg = verify_file(raw_file)
    if not ok:
        raise LoadError(f"refusing to load: {msg}")
    manifest = read_manifest(raw_file)
    source = manifest["provider"]
    ids = instrument_ids(conn)
    raw = pl.read_parquet(raw_file)
    if source == "tiingo":  # actions travel inside the daily record file
        acts = normalise_tiingo_actions(raw, manifest["parameters"]["symbol"])
    else:
        acts = normalise_actions(raw)
    n_read = acts.height
    valid, rejected = validate_actions(merge_same_day_dividends(acts), set(ids))

    def work(cur: psycopg.Cursor, job_id: int) -> dict:
        _quarantine(cur, job_id, rejected, ["symbol", "ex_date"])
        merged_away = n_read - valid.height - rejected.height
        counts = {"read": n_read, "inserted": 0, "updated": 0, "unchanged": merged_away,
                  "rejected": rejected.height}
        for r in valid.iter_rows(named=True):
            cur.execute(
                "INSERT INTO market.corporate_action AS t (instrument_id, action_type, ex_date, "
                "split_from, split_to, cash_amount, source, ingestion_job_id) "
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s) "
                "ON CONFLICT (instrument_id, action_type, ex_date, source) DO UPDATE SET "
                "split_from=EXCLUDED.split_from, split_to=EXCLUDED.split_to, "
                "cash_amount=EXCLUDED.cash_amount, ingestion_job_id=EXCLUDED.ingestion_job_id, "
                "loaded_at=now() "
                "WHERE (t.split_from, t.split_to, t.cash_amount) IS DISTINCT FROM "
                "(EXCLUDED.split_from, EXCLUDED.split_to, EXCLUDED.cash_amount) "
                "RETURNING (xmax = 0)",
                (ids[r["symbol"]], r["action_type"], r["ex_date"], r["split_from"], r["split_to"],
                 r["cash_amount"], source, job_id),
            )
            row = cur.fetchone()
            if row is None:
                counts["unchanged"] += 1
            elif row[0]:
                counts["inserted"] += 1
            else:
                counts["updated"] += 1
        return counts

    return _run_job(conn, "corporate_actions", source, raw_file, manifest["file_sha256"], work)


def load_universe_files(conn: psycopg.Connection, universe: pl.DataFrame, data_dir: Path | None = None) -> list[dict]:
    """Load instruments, then the latest raw file of each symbol and the corporate actions."""
    from market_data.ingestion.download import raw_files

    data_dir = data_dir or config.DATA_DIR
    upsert_instruments(conn, universe)
    results = []
    bars_dir = data_dir / "raw" / "alpaca" / "bars_1d"
    for sym in universe["symbol"].to_list():
        files = raw_files(bars_dir, sym)
        if not files:
            results.append({"symbol": sym, "skipped": "no raw file"})
            continue
        results.append({"symbol": sym, **load_bars(conn, files[-1])})
    actions = raw_files(data_dir / "raw" / "alpaca" / "corporate_actions", "corporate_actions")
    if actions:
        results.append({"symbol": "*corporate_actions*", **load_corporate_actions(conn, actions[-1])})
    return results


def load_tiingo_universe(conn: psycopg.Connection, universe: pl.DataFrame, data_dir: Path | None = None) -> list[dict]:
    """Load the latest Tiingo raw file of each symbol: bars (source='tiingo') and its corporate actions."""
    from market_data.ingestion.download import raw_files

    data_dir = data_dir or config.DATA_DIR
    upsert_instruments(conn, universe)
    bars_dir = data_dir / "raw" / "tiingo" / "bars_1d"
    results = []
    for sym in universe["symbol"].to_list():
        files = raw_files(bars_dir, sym)
        if not files:
            results.append({"symbol": sym, "skipped": "no raw file"})
            continue
        b = load_bars(conn, files[-1])
        a = load_corporate_actions(conn, files[-1])
        results.append({"symbol": sym, "bars": b, "actions": a})
    return results
