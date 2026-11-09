"""HTTP API: `market_data.api:app` (FastAPI). Routers live in `market_data.api.routers`."""

from market_data.api.app import app, get_conn, openapi_schema  # noqa: F401
