"""Download raw daily bars and corporate actions from Alpaca, with manifests.

Raw files are immutable: an existing file is never overwritten; a new file with
the retrieval timestamp in its name is written instead.
"""

import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

import httpx
import polars as pl

from market_data import config
from market_data.manifest import manifest_path, read_manifest, write_manifest

BASE_URL = "https://data.alpaca.markets"
BARS_ENDPOINT = "/v2/stocks/{symbol}/bars"
ACTIONS_ENDPOINT = "/v1/corporate-actions"
DEFAULT_FEED = "iex"  # free plan; IEX volumes are a subset of consolidated volume
MAX_TRIES = 5
LICENSE_NOTE = (
    "Alpaca Market Data API, free plan. Personal/educational use; raw data is not "
    "redistributed (data/ is git-ignored). See docs/02-domain/data-dictionary.md, Sources."
)

BAR_SCHEMA = {
    "t": pl.String, "o": pl.Float64, "h": pl.Float64, "l": pl.Float64,
    "c": pl.Float64, "v": pl.Int64, "n": pl.Int64, "vw": pl.Float64,
}
ACTION_SCHEMA = {
    "action_type": pl.String, "symbol": pl.String, "ex_date": pl.String,
    "new_rate": pl.Float64, "old_rate": pl.Float64, "rate": pl.Float64,
    "process_date": pl.String, "record_date": pl.String, "payable_date": pl.String,
}


class DownloadError(RuntimeError):
    pass


def make_client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    key = os.environ.get("ALPACA_API_KEY_ID", "")
    secret = os.environ.get("ALPACA_API_SECRET_KEY", "")
    if not key or not secret:
        raise DownloadError("ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY are not set in .env")
    return httpx.Client(
        base_url=BASE_URL,
        headers={"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret},
        timeout=30.0,
        transport=transport,
    )


def _get(client: httpx.Client, path: str, params: dict, sleep: Callable[[float], None]) -> dict:
    """GET with bounded exponential backoff on 429 and 5xx. Never logs headers."""
    last = ""
    for attempt in range(MAX_TRIES):
        try:
            resp = client.get(path, params=params)
        except httpx.TransportError as exc:
            last = f"transport error: {type(exc).__name__}"
        else:
            if resp.status_code == 200:
                return resp.json()
            if resp.status_code == 429 or resp.status_code >= 500:
                last = f"HTTP {resp.status_code}"
            else:
                raise DownloadError(f"HTTP {resp.status_code} for {path}: {resp.text[:200]}")
        if attempt < MAX_TRIES - 1:
            sleep(min(2.0**attempt, 30.0))
    raise DownloadError(f"giving up on {path} after {MAX_TRIES} tries ({last})")


def fetch_daily_bars(
    symbol: str, start: str, end: str, *, client: httpx.Client,
    feed: str = DEFAULT_FEED, sleep: Callable[[float], None] = time.sleep,
) -> pl.DataFrame:
    params = {
        "timeframe": "1Day", "adjustment": "raw", "feed": feed,
        "start": start, "end": end, "limit": 10000, "sort": "asc",
    }
    rows: list[dict] = []
    while True:
        body = _get(client, BARS_ENDPOINT.format(symbol=symbol), params, sleep)
        rows.extend(body.get("bars") or [])
        token = body.get("next_page_token")
        if not token:
            break
        params = {**params, "page_token": token}
    return pl.DataFrame(rows, schema=BAR_SCHEMA)


def fetch_corporate_actions(
    symbols: list[str], start: str, end: str, *, client: httpx.Client,
    sleep: Callable[[float], None] = time.sleep,
) -> pl.DataFrame:
    params = {
        "symbols": ",".join(symbols), "types": "forward_split,reverse_split,cash_dividend",
        "start": start, "end": end, "limit": 1000,
    }
    type_map = {"forward_splits": "forward_split", "reverse_splits": "reverse_split",
                "cash_dividends": "cash_dividend"}
    rows: list[dict] = []
    while True:
        body = _get(client, ACTIONS_ENDPOINT, params, sleep)
        for key, items in (body.get("corporate_actions") or {}).items():
            if key not in type_map:
                continue
            for it in items:
                rows.append({
                    "action_type": type_map[key], "symbol": it.get("symbol"),
                    "ex_date": it.get("ex_date"), "new_rate": it.get("new_rate"),
                    "old_rate": it.get("old_rate"), "rate": it.get("rate"),
                    "process_date": it.get("process_date"), "record_date": it.get("record_date"),
                    "payable_date": it.get("payable_date"),
                })
        token = body.get("next_page_token")
        if not token:
            break
        params = {**params, "page_token": token}
    df = pl.DataFrame(rows, schema=ACTION_SCHEMA)
    return df.sort(["symbol", "ex_date", "action_type"])


def _unique_path(path: Path, now: datetime) -> Path:
    if not path.exists():
        return path
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    return path.with_name(f"{path.stem}.{stamp}{path.suffix}")


def _write_raw(df: pl.DataFrame, target: Path, now: datetime) -> Path:
    target.parent.mkdir(parents=True, exist_ok=True)
    path = _unique_path(target, now)
    df.write_parquet(path, compression="zstd", statistics=False)
    return path


def raw_files(raw_dir: Path, stem: str) -> list[Path]:
    """All raw files for a stem, newest last (plain name sorts first, then timestamps)."""
    out = [p for p in raw_dir.glob(f"{stem}*.parquet") if p.stem == stem or p.stem.startswith(stem + ".")]
    return sorted(out, key=lambda p: (p.stem != stem, p.name))  # plain name first, then timestamped, newest last


def _latest_matching(raw_dir: Path, stem: str, parameters: dict) -> Path | None:
    for raw in reversed(raw_files(raw_dir, stem)):
        if manifest_path(raw).exists() and read_manifest(raw)["parameters"] == parameters:
            return raw
    return None


def download_universe(
    symbols: list[str], start: str = config.DEFAULT_START, end: str = config.DEFAULT_END,
    *, feed: str = DEFAULT_FEED, force: bool = False, data_dir: Path | None = None,
    client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep,
) -> dict:
    """Download bars per symbol and one corporate-actions file. Returns a summary."""
    data_dir = data_dir or config.DATA_DIR
    bars_dir = data_dir / "raw" / "alpaca" / "bars_1d"
    actions_dir = data_dir / "raw" / "alpaca" / "corporate_actions"
    summary = {"downloaded": 0, "skipped": 0, "rows": 0}
    t0 = time.perf_counter()

    pending = []
    for sym in symbols:
        params = {"symbol": sym, "start": start, "end": end, "timeframe": "1Day",
                  "adjustment": "raw", "feed": feed}
        if not force and _latest_matching(bars_dir, sym, params):
            summary["skipped"] += 1
        else:
            pending.append((sym, params))
    action_params = {"symbols": sorted(symbols), "start": start, "end": end,
                     "types": "forward_split,reverse_split,cash_dividend"}
    need_actions = force or not _latest_matching(actions_dir, "corporate_actions", action_params)
    if not need_actions:
        summary["skipped"] += 1

    if not pending and not need_actions:
        summary["seconds"] = 0.0
        return summary

    client = client or make_client()
    for sym, params in pending:
        now = datetime.now(UTC)
        df = fetch_daily_bars(sym, start, end, client=client, feed=feed, sleep=sleep)
        path = _write_raw(df, bars_dir / f"{sym}.parquet", now)
        write_manifest(path, provider="alpaca", endpoint=BASE_URL + BARS_ENDPOINT.format(symbol=sym),
                       parameters=params, row_count=df.height, license_note=LICENSE_NOTE,
                       retrieved_at=now)
        summary["downloaded"] += 1
        summary["rows"] += df.height

    if need_actions:
        now = datetime.now(UTC)
        df = fetch_corporate_actions(symbols, start, end, client=client, sleep=sleep)
        path = _write_raw(df, actions_dir / "corporate_actions.parquet", now)
        write_manifest(path, provider="alpaca", endpoint=BASE_URL + ACTIONS_ENDPOINT,
                       parameters=action_params, row_count=df.height, license_note=LICENSE_NOTE,
                       retrieved_at=now)
        summary["downloaded"] += 1

    summary["seconds"] = round(time.perf_counter() - t0, 2)
    return summary
