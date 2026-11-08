# ADR 0007: Expose the service as an HTTP API with Swagger in the Python service

Status: accepted (Sprint 02)

## Context
The future NestJS service and frontend must not read the market schema directly (ADR 0002). The owner also wants to test every function by hand.

## Decision
FastAPI + uvicorn inside market-data. Swagger UI at /docs, OpenAPI exported to docs/02-domain/openapi-market-data.json and checked by a test. Tags: Reference, Bars, Adjustment, Indicators, Replay, Lineage, Data quality, Ingestion, Benchmark. Pure functions (adjustment, indicators, causality check, quality rules) take sample data in the request body so they can be tried without a database. The server binds to 127.0.0.1 and refuses other hosts without --allow-remote. There is no authentication: it is a local tool.

## Alternatives
Keep functions CLI-only (no visual testing); build the NestJS layer now (out of scope for this sprint).

## Consequences
New dependencies: fastapi, uvicorn. Endpoints under Ingestion and POST /quality/run write data or call Alpaca and must stay local-only. Replay sessions are held in memory and are lost on restart. Authentication must be added before any non-local use.
