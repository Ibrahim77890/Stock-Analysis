"""Request ids, JSON request logs and in-process metrics for the Python service (Sprint 10, tasks 10_02 and 10_03).

One middleware does three things per request:
1. takes the id from the header `x-request-id` (sent by the gateway) or makes one, and returns it in the reply header;
2. writes ONE JSON line (time, method, route pattern, status, duration, request id). Never the URL with ids, a query, a body or a header value;
3. counts the call per route pattern (rate, 4xx, 5xx, durations) for `GET /metrics`.
"""

from __future__ import annotations

import json
import secrets
import time
from collections import deque
from datetime import datetime, timezone

from fastapi import FastAPI, Request

HEADER = "x-request-id"
MAX_DURATIONS = 1000
STARTED = time.time()


def _stdout(line: str) -> None:
    print(line, flush=True)


LOG_SINK = _stdout          # tests replace it to capture lines


class Metrics:
    def __init__(self) -> None:
        self.routes: dict[str, dict] = {}

    def add(self, route: str, status: int, ms: float) -> None:
        r = self.routes.setdefault(route, {"count": 0, "client_errors": 0, "server_errors": 0, "durations": deque(maxlen=MAX_DURATIONS)})
        r["count"] += 1
        if 400 <= status < 500:
            r["client_errors"] += 1
        elif status >= 500:
            r["server_errors"] += 1
        r["durations"].append(ms)

    def snapshot(self) -> dict:
        out = []
        for route, r in sorted(self.routes.items(), key=lambda kv: -kv[1]["count"]):
            d = sorted(r["durations"])
            out.append({"route": route, "count": r["count"], "client_errors": r["client_errors"], "server_errors": r["server_errors"],
                        "p50_ms": percentile(d, 50), "p95_ms": percentile(d, 95), "max_ms": d[-1] if d else None})
        return {"service": "python", "uptime_seconds": int(time.time() - STARTED), "routes": out,
                "note": "Counts since this service started. Durations keep the last 1000 calls per route."}


def percentile(sorted_values: list[float], p: float) -> float | None:
    """Linear interpolation between closest ranks (the same rule as PostgreSQL percentile_cont)."""
    if not sorted_values:
        return None
    k = (len(sorted_values) - 1) * p / 100.0
    lo = int(k)
    hi = min(lo + 1, len(sorted_values) - 1)
    return round(sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (k - lo), 3)


metrics = Metrics()


def install(app: FastAPI) -> None:
    @app.middleware("http")
    async def observe(request: Request, call_next):
        rid = request.headers.get(HEADER) or secrets.token_hex(8)
        t0 = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers[HEADER] = rid
            return response
        finally:
            ms = round((time.perf_counter() - t0) * 1000, 3)
            route = request.scope.get("route")
            pattern = getattr(route, "path", None) or "unmatched"
            key = f"{request.method} {pattern}"
            metrics.add(key, status, ms)
            LOG_SINK(json.dumps({"time": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "service": "python", "method": request.method,
                                 "route": pattern, "status": status, "duration_ms": ms, "request_id": rid}))
