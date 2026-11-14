"""Swagger sections "Metrics" and "Data": service metrics and the data status summary (Sprint 10).

INTERNAL (the NestJS gateway calls them). With INTERNAL_API_TOKEN set every call needs X-Internal-Token. Reads only.
"""

from __future__ import annotations

import psycopg
from fastapi import APIRouter, Depends

from market_data.api import observability
from market_data.api.routers.learning import require_internal_token
from market_data.market.status import data_status


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(dependencies=[Depends(require_internal_token)])

    @r.get("/metrics", tags=["Metrics"], summary="metrics: calls, 4xx and 5xx counts and p50, p95, max duration per route since the service started")
    def get_metrics() -> dict:
        return observability.metrics.snapshot()

    @r.get("/data/status", tags=["Data"], summary="data_status: sources, coverage, freshness, quality checks and caveats (no paths, hashes or keys)")
    def status(conn: psycopg.Connection = Depends(conn_dep)) -> dict:
        return data_status(conn)

    return r
