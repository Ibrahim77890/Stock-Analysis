# A small HTTP read API with FastAPI

**Sprint:** 02    **Used by tasks:** 02_06

## Why this matters for MarketLab
The future NestJS service and frontend must not touch the `market` schema directly (blueprint 24: schema ownership). They need a narrow, documented, testable contract. A read-only HTTP API in the Python service gives them that, and it is the layer where the replay cursor and as-of adjustment rules become visible to users.

## Plain-language explanation
FastAPI turns typed Python functions into HTTP endpoints and generates an OpenAPI description at `/openapi.json` (and interactive docs at `/docs`). Request parameters are validated from their type hints: `start: date` rejects `start=banana` with HTTP 422 before your code runs. A good read API for this project:
- is **read-only** (only GET), validates every input, and returns clear errors (404 unknown symbol, 400 start after end, 422 bad types);
- takes a **cursor** parameter and applies it in the data-access layer, never in the handler alone;
- returns a stable JSON shape (columns as arrays or row objects), with prices as numbers and dates as ISO strings;
- uses a connection pool or one short-lived connection per request;
- runs on `127.0.0.1` only for now, with no authentication (local tool; say so).

Example: `GET /bars?symbol=AAPL&start=2020-08-25&end=2020-09-04&adjustment=split&cursor=2020-09-01` returns the bars from 2020-08-25 to 2020-09-01, split-adjusted as of 2020-09-01.

## Key terms
- Endpoint, query parameter, status code (200, 400, 404, 422)
- OpenAPI schema, response model (Pydantic)
- ASGI server (uvicorn), TestClient
- Schema ownership: only the market-data service reads/writes `market`
- Idempotent safe method (GET changes nothing)

## Common mistakes / pitfalls
- Returning database rows without a response model, so a column change silently changes the API.
- Building SQL by string concatenation from parameters (SQL injection); use query parameters.
- Letting the client choose the cursor semantics (the server owns it) or the SQL schema name.
- Returning NaN/Infinity in JSON (invalid JSON); use null.
- Starting the server on `0.0.0.0` by accident.

## What to implement in this domain
- A `api` module (owner decides the path) with `GET /health`, `GET /instruments`, `GET /bars`, and later `GET /lineage/{symbol}`.
- Response models and an exported `openapi.json` checked by a test (so contract changes are deliberate).
- Automated tests with FastAPI's `TestClient` against the test database: happy path, unknown symbol, start after end, cursor earlier than start (empty result), cursor bound fuzz.
- A command to run the server on `127.0.0.1` and a README line.
- New dependencies only: `fastapi` and `uvicorn` (record in the status log).

## How to check you understood
1. What status does `start=banana` get, and who produces it? (422, produced by FastAPI validation.)
2. Why may the NestJS service not query `market.bar_daily` directly? (Schema ownership: only the Python service reads/writes it.)
3. Where is the cursor enforced? (In the data-access layer, so no handler can forget it.)

## References
- [FastAPI documentation](https://fastapi.tiangolo.com/): tutorial on path/query parameters, response models, testing.
- [FastAPI: Testing](https://fastapi.tiangolo.com/tutorial/testing/) (unverified): `TestClient` usage.
- [OpenAPI Specification](https://spec.openapis.org/oas/latest.html): what the generated contract means.
- [uvicorn](https://www.uvicorn.org/): running an ASGI app locally.
- [psycopg 3: Connection pools](https://www.psycopg.org/psycopg3/docs/advanced/pool.html) (unverified): pooled connections.
