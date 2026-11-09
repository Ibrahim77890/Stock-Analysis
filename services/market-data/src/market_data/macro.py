"""FRED macro series: download with manifests, idempotent load, pure as-of logic (task 05_05).

Series: DGS3MO (3-month Treasury yield, percent per year) and VIXCLS (VIX close, index points).
FRED requires the key as a query parameter, so request URLs are never logged or stored, and every
error text passes through `config.redact`. "." (a missing day) is stored as NULL, never 0.

This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
"""

from __future__ import annotations

import bisect
import time
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Callable, Sequence

import httpx
import polars as pl
import psycopg

from market_data import config
from market_data.manifest import manifest_path, read_manifest, verify_file, write_manifest

BASE_URL = "https://api.stlouisfed.org"
ENDPOINT = "/fred/series/observations"
SERIES = ("DGS3MO", "VIXCLS")
SOURCE = "fred"
DEFAULT_START = "2000-01-01"
ATTRIBUTION = ("This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank "
               "of St. Louis.")
LICENSE_NOTE = (f"FRED API. Third-party series may be copyrighted (VIXCLS: CBOE); personal use, data stay local "
                f"(data/ is git-ignored). {ATTRIBUTION}")
RAW_SCHEMA = {"date": pl.String, "value": pl.String}
MAX_TRIES = 3


class MacroError(RuntimeError):
    pass


# --------------------------------------------------------------------------- pure as-of logic

def parse_value(text: str | None) -> float | None:
    """FRED's "." (and empty) mean "no observation"; anything else must be a number."""
    if text is None or text.strip() in (".", ""):
        return None
    return float(text)


def asof_lookup(dates: Sequence[date], values: Sequence[float | None], d: date, strict: bool = True) -> tuple[date, float]:
    """Latest NON-NULL observation with obs_date < d (strict) or <= d. `dates` ascending.

    Raises LookupError when there is none (never assumes 0)."""
    i = (bisect.bisect_left if strict else bisect.bisect_right)(dates, d) - 1
    while i >= 0 and values[i] is None:
        i -= 1
    if i < 0:
        raise LookupError(f"no observation {'before' if strict else 'on or before'} {d}")
    return dates[i], values[i]  # type: ignore[return-value]


def asof_series(obs: pl.DataFrame, dates: Sequence[date], strict: bool = True) -> list[float]:
    """as-of value for each date in `dates` (same rule as asof_lookup)."""
    ds, vs = obs["obs_date"].to_list(), obs["value"].to_list()
    return [asof_lookup(ds, vs, d, strict)[1] for d in dates]


TRADING_DAYS = 252
VIX_LOW, VIX_HIGH = 15.0, 25.0   # fixed buckets chosen in advance: low < 15, medium 15 to 25, high >= 25


def risk_free_series(obs: pl.DataFrame, dates: Sequence[date]) -> list[float]:
    """rf_t = (y / 100) / 252 where y is the last non-null yield observed STRICTLY before day t.

    Raises LookupError if a date precedes the first usable observation."""
    return [y / 100.0 / TRADING_DAYS for y in asof_series(obs, dates, strict=True)]


def daily_risk_free(conn: psycopg.Connection, dates: Sequence[date], series_id: str = "DGS3MO") -> list[float]:
    from market_data.read import get_macro

    return risk_free_series(get_macro(conn, series_id), dates)


def vix_bucket(value: float | None) -> str:
    if value is None:
        return "unknown"
    return "low" if value < VIX_LOW else ("medium" if value < VIX_HIGH else "high")


def vix_labels(obs: pl.DataFrame, dates: Sequence[date]) -> list[str]:
    """Bucket of the previous trading day's VIX close (strictly earlier observation); 'unknown' if none exists."""
    ds, vs = obs["obs_date"].to_list(), obs["value"].to_list()
    out = []
    for d in dates:
        try:
            out.append(vix_bucket(asof_lookup(ds, vs, d, strict=True)[1]))
        except LookupError:
            out.append("unknown")
    return out


# --------------------------------------------------------------------------- download

def make_client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, timeout=30.0, transport=transport)


def fred_fetch(series_id: str, start: str, end: str | None = None, *, key: str | None = None,
               client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep) -> list[dict]:
    """GET observations as [{date, value}] with value kept as FRED's text ("." included)."""
    key = key or config.fred_key()
    client = client or make_client()
    params = {"series_id": series_id, "api_key": key, "file_type": "json", "units": "lin",
              "observation_start": start}
    if end:
        params["observation_end"] = end
    last = ""
    for attempt in range(MAX_TRIES):
        try:
            resp = client.get(ENDPOINT, params=params)
        except httpx.TransportError as exc:
            last = f"transport error: {type(exc).__name__}"
        else:
            if resp.status_code == 200:
                return [{"date": o["date"], "value": o["value"]} for o in resp.json().get("observations", [])]
            if resp.status_code == 429 or resp.status_code >= 500:
                last = f"HTTP {resp.status_code}"
            else:
                raise MacroError(config.redact(f"HTTP {resp.status_code} for series {series_id}: {resp.text[:200]}"))
        if attempt < MAX_TRIES - 1:
            sleep(2.0 ** attempt)
    raise MacroError(f"giving up on series {series_id} after {MAX_TRIES} tries ({last})")


def raw_dir(data_dir: Path | None = None) -> Path:
    return (data_dir or config.DATA_DIR) / "raw" / "fred"


def download_fred(series: Sequence[str] = SERIES, start: str = DEFAULT_START, end: str = config.DEFAULT_END,
                  *, force: bool = False, data_dir: Path | None = None, client: httpx.Client | None = None,
                  sleep: Callable[[float], None] = time.sleep) -> dict:
    out = raw_dir(data_dir)
    out.mkdir(parents=True, exist_ok=True)
    summary = {"written": 0, "skipped": 0, "rows": {}}
    for sid in series:
        params = {"series_id": sid, "start": start, "end": end, "units": "lin"}
        target = out / f"{sid}.parquet"
        if not force and target.exists() and manifest_path(target).exists() \
                and read_manifest(target)["parameters"] == params:
            summary["skipped"] += 1
            continue
        rows = fred_fetch(sid, start, end, client=client, sleep=sleep)
        now = datetime.now(UTC)
        if target.exists():
            target = target.with_name(f"{sid}.{now.strftime('%Y%m%dT%H%M%SZ')}.parquet")
        df = pl.DataFrame(rows, schema=RAW_SCHEMA)
        df.write_parquet(target, compression="zstd", statistics=False)
        write_manifest(target, provider="fred", endpoint=BASE_URL + ENDPOINT, parameters=params,
                       row_count=df.height, license_note=LICENSE_NOTE, retrieved_at=now)
        summary["written"] += 1
        summary["rows"][sid] = df.height
    return summary


# --------------------------------------------------------------------------- load

def normalise_macro(raw: pl.DataFrame, series_id: str) -> tuple[pl.DataFrame, pl.DataFrame]:
    """(valid rows: series_id, obs_date, value; rejected rows with a reason).

    "." becomes NULL (valid). Unparsable dates or values, out-of-range values and repeated dates are rejected."""
    rows, rej, seen = [], [], set()
    for r in raw.iter_rows(named=True):
        try:
            d = date.fromisoformat(str(r["date"])[:10])
        except ValueError:
            rej.append({"date": r["date"], "value": r["value"], "reason": "bad_date"})
            continue
        try:
            v = parse_value(r["value"])
        except ValueError:
            rej.append({"date": r["date"], "value": r["value"], "reason": "non_numeric_value"})
            continue
        if v is not None and v <= -1000:
            rej.append({"date": r["date"], "value": r["value"], "reason": "out_of_range"})
            continue
        if d in seen:
            rej.append({"date": r["date"], "value": r["value"], "reason": "duplicate_key"})
            continue
        seen.add(d)
        rows.append((series_id, d, v))
    valid = pl.DataFrame(rows, schema={"series_id": pl.String, "obs_date": pl.Date, "value": pl.Float64}, orient="row")
    rejected = pl.DataFrame(rej, schema={"date": pl.String, "value": pl.String, "reason": pl.String})
    return valid, rejected


def load_macro_file(conn: psycopg.Connection, raw_file: Path) -> dict:
    from market_data.load import LoadError, _run_job

    ok, msg = verify_file(raw_file)
    if not ok:
        raise LoadError(f"refusing to load: {msg}")
    manifest = read_manifest(raw_file)
    series_id = manifest["parameters"]["series_id"]
    raw = pl.read_parquet(raw_file)
    valid, rejected = normalise_macro(raw, series_id)

    def work(cur: psycopg.Cursor, job_id: int) -> dict:
        cur.execute("CREATE TEMP TABLE IF NOT EXISTS stage_macro (series_id text, obs_date date, "
                    "value numeric(18,6)) ON COMMIT DROP")
        cur.execute("TRUNCATE stage_macro")
        with cur.copy("COPY stage_macro (series_id, obs_date, value) FROM STDIN") as cp:
            for r in valid.iter_rows():
                cp.write_row(r)
        cur.execute(
            "INSERT INTO market.macro_observation AS t (series_id, obs_date, value, source, ingestion_job_id) "
            "SELECT series_id, obs_date, value, %s, %s FROM stage_macro "
            "ON CONFLICT (series_id, obs_date, source) DO UPDATE SET value = EXCLUDED.value, "
            "ingestion_job_id = EXCLUDED.ingestion_job_id, loaded_at = now() "
            "WHERE t.value IS DISTINCT FROM EXCLUDED.value RETURNING (xmax = 0)", (SOURCE, job_id))
        flags = [r[0] for r in cur.fetchall()]
        ins = sum(flags)
        return {"read": raw.height, "inserted": ins, "updated": len(flags) - ins,
                "unchanged": valid.height - len(flags), "rejected": rejected.height}

    res = _run_job(conn, "macro", SOURCE, raw_file, manifest["file_sha256"], work)
    return {"series_id": series_id, **res}


def load_fred(conn: psycopg.Connection, series: Sequence[str] = SERIES, data_dir: Path | None = None) -> list[dict]:
    from market_data.download import raw_files

    out = []
    for sid in series:
        files = raw_files(raw_dir(data_dir), sid)
        out.append(load_macro_file(conn, files[-1]) if files else {"series_id": sid, "skipped": "no raw file"})
    return out
