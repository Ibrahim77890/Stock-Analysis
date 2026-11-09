"""Resumable download of raw daily Tiingo records (Sprint 05, task 05_02).

One request per symbol. The key travels in the Authorization header only, never in a URL, a
file, a log line or an exception text (`config.redact` is applied to anything that is raised).
Raw files are Parquet with every vendor field (the adj* fields stay in the file for the vendor
check; the loader ignores them). A rerun skips symbols whose manifest already matches.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

import httpx
import polars as pl

from market_data import config
from market_data.manifest import manifest_path, read_manifest, write_manifest

BASE_URL = "https://api.tiingo.com"
ENDPOINT = "/tiingo/daily/{symbol}/prices"
DEFAULT_MAX_REQUESTS = 45  # the free plan allows 50 per hour
MAX_5XX_TRIES = 3
LICENSE_NOTE = (
    "Tiingo End-of-Day, Starter (free) plan: Internal Use Only. Data stay local (data/ is git-ignored); "
    "never redistributed. See docs/02-domain/data-dictionary.md, Sources, and ADR 0013."
)
RAW_SCHEMA = {
    "date": pl.String, "open": pl.Float64, "high": pl.Float64, "low": pl.Float64, "close": pl.Float64,
    "volume": pl.Int64, "adjOpen": pl.Float64, "adjHigh": pl.Float64, "adjLow": pl.Float64,
    "adjClose": pl.Float64, "adjVolume": pl.Int64, "divCash": pl.Float64, "splitFactor": pl.Float64,
}
EXIT_QUOTA = 3


class TiingoError(RuntimeError):
    pass


class QuotaReached(TiingoError):
    """HTTP 429: the free-tier request limit was hit."""


class SymbolNotFound(TiingoError):
    pass


class RequestBudgetExhausted(TiingoError):
    pass


def vendor_symbol(symbol: str) -> str:
    """Tiingo writes share classes with a hyphen (BRK-B); our database keeps the Alpaca spelling (BRK.B)."""
    return symbol.replace(".", "-")


def make_client(token: str | None = None, transport: httpx.BaseTransport | None = None) -> httpx.Client:
    return httpx.Client(base_url=BASE_URL, headers={"Authorization": f"Token {token or config.tiingo_key()}"},
                        timeout=30.0, transport=transport)


class Budget:
    """Counts every HTTP request (retries included) against max_requests."""

    def __init__(self, max_requests: int) -> None:
        self.max, self.used = max_requests, 0

    def take(self) -> None:
        if self.used >= self.max:
            raise RequestBudgetExhausted(f"max_requests={self.max} reached")
        self.used += 1


def tiingo_fetch(symbol: str, start: str, end: str, *, client: httpx.Client, budget: Budget | None = None,
                 sleep: Callable[[float], None] = time.sleep) -> list[dict]:
    """GET daily prices. 429 -> QuotaReached, 404 -> SymbolNotFound, 5xx retried 3 times with backoff."""
    path = ENDPOINT.format(symbol=vendor_symbol(symbol))
    params = {"startDate": start, "endDate": end, "format": "json", "resampleFreq": "daily"}
    last = ""
    for attempt in range(MAX_5XX_TRIES):
        if budget is not None:
            budget.take()
        try:
            resp = client.get(path, params=params)
        except httpx.TransportError as exc:
            last = f"transport error: {type(exc).__name__}"
        else:
            if resp.status_code == 200:
                body = resp.json()
                if not isinstance(body, list):
                    raise TiingoError(f"unexpected response shape for {symbol}")
                return body
            if resp.status_code == 429:
                raise QuotaReached("quota reached; rerun later")
            if resp.status_code == 404:
                raise SymbolNotFound(symbol)
            if resp.status_code >= 500:
                last = f"HTTP {resp.status_code}"
            else:
                raise TiingoError(config.redact(f"HTTP {resp.status_code} for {symbol}: {resp.text[:200]}"))
        if attempt < MAX_5XX_TRIES - 1:
            sleep(min(2.0 ** attempt, 30.0))
    raise TiingoError(f"giving up on {symbol} after {MAX_5XX_TRIES} tries ({last})")


def raw_dir(data_dir: Path | None = None) -> Path:
    return (data_dir or config.DATA_DIR) / "raw" / "tiingo" / "bars_1d"


def _frame(records: list[dict]) -> pl.DataFrame:
    rows = [{k: r.get(k) for k in RAW_SCHEMA} for r in records]
    return pl.DataFrame(rows, schema=RAW_SCHEMA)


def _matching(path_dir: Path, symbol: str, params: dict) -> Path | None:
    p = path_dir / f"{symbol}.parquet"
    if p.exists() and manifest_path(p).exists() and read_manifest(p)["parameters"] == params:
        return p
    return None


def _status_path(data_dir: Path) -> Path:
    return data_dir / "raw" / "tiingo" / "not_found.json"


def _load_not_found(data_dir: Path) -> dict:
    p = _status_path(data_dir)
    return json.loads(p.read_text()) if p.exists() else {}


def download_tiingo(
    symbols: list[str], start: str = config.TIINGO_START, end: str = config.DEFAULT_END,
    *, max_requests: int = DEFAULT_MAX_REQUESTS, force: bool = False, data_dir: Path | None = None,
    client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep,
    write_report: bool = True,
) -> dict:
    """Download until done or stopped. Returns a summary whose counts add up to len(symbols)."""
    data_dir = data_dir or config.DATA_DIR
    out_dir = raw_dir(data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    not_found = _load_not_found(data_dir)
    summary = {"requested": len(symbols), "skipped": 0, "written": 0, "failed": 0, "not_found": 0,
               "remaining": 0, "stopped_by": "complete", "http_requests": 0, "failures": {}}
    budget = Budget(max_requests)
    todo: list[tuple[str, dict]] = []
    for sym in symbols:
        params = {"symbol": sym, "start": start, "end": end}
        if not force and _matching(out_dir, sym, params):
            summary["skipped"] += 1
        elif not force and sym in not_found:
            summary["not_found"] += 1
        else:
            todo.append((sym, params))

    if todo:
        client = client or make_client()
    for i, (sym, params) in enumerate(todo):
        try:
            records = tiingo_fetch(sym, start, end, client=client, budget=budget, sleep=sleep)
        except QuotaReached:
            summary["stopped_by"] = "quota"
            summary["remaining"] = len(todo) - i
            break
        except RequestBudgetExhausted:
            summary["stopped_by"] = "max_requests"
            summary["remaining"] = len(todo) - i
            break
        except SymbolNotFound:
            not_found[sym] = {"checked_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")}
            _status_path(data_dir).write_text(json.dumps(not_found, indent=2, sort_keys=True))
            summary["not_found"] += 1
            continue
        except TiingoError as exc:
            summary["failed"] += 1
            summary["failures"][sym] = config.redact(str(exc))
            continue
        if not records:
            not_found[sym] = {"checked_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), "empty": True}
            _status_path(data_dir).write_text(json.dumps(not_found, indent=2, sort_keys=True))
            summary["not_found"] += 1
            continue
        now = datetime.now(UTC)
        df = _frame(records)
        target = out_dir / f"{sym}.parquet"
        if target.exists():  # raw files are immutable: write a timestamped sibling instead
            target = target.with_name(f"{sym}.{now.strftime('%Y%m%dT%H%M%SZ')}.parquet")
        df.write_parquet(target, compression="zstd", statistics=False)
        write_manifest(target, provider="tiingo", endpoint=BASE_URL + ENDPOINT.format(symbol=vendor_symbol(sym)),
                       parameters=params, row_count=df.height, license_note=LICENSE_NOTE, retrieved_at=now)
        summary["written"] += 1
    summary["http_requests"] = budget.used
    # every requested symbol is in exactly one bucket
    total = (summary["skipped"] + summary["written"] + summary["failed"] + summary["not_found"]
             + summary["remaining"])
    if total != summary["requested"]:
        raise TiingoError(f"summary does not add up: {total} != {summary['requested']}")
    if write_report:
        stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        rep_dir = data_dir / "reports"
        rep_dir.mkdir(parents=True, exist_ok=True)
        (rep_dir / f"tiingo-download-{stamp}.json").write_text(json.dumps(summary, indent=2, sort_keys=True))
    return summary
