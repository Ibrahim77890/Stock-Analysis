# ADR 0016: Package layout of the market-data service

Status: accepted (2026-11-09, between Sprint 05 and Sprint 06)

## Context
After five sprints `src/market_data/` held 32 modules and `tests/` 40 files at one level, with names such as `api_backtest.py` and `download_tiingo.py` standing in for structure. New work (learning episodes, scoring, more routers) would have made it worse, and the rules we rely on (only a few modules touch `market.bar_daily`; the API only calls lower layers) were not visible in the tree.

## Decision
Group modules into packages that follow what they do and who owns the data. Dependencies point downwards only.

| Package | Contents (old flat name -> new path) |
|---|---|
| `core` | `config`, `keys`, `manifest`, `universe` |
| `ingestion` | `download`, `download_tiingo`, `load`, `macro`, `quality` |
| `market` | `read`, `adjust`, `adjust_check`, `reconcile`, `replay`, `indicators`, `lineage`, `synthetic` |
| `backtesting` | `backtest`, `metrics`, `luck`, `research` |
| `validation` | `validation` -> `protocol`, `sharpe_stats`, `scan`, `regimes` |
| `api` | `api` -> `app.py`; routers in `api/routers/`: `api_backtest` -> `backtest`, `api_sources` -> `sources`, `api_validation` -> `validation` |
| `bench` | `bench` -> `benchmark` |
| top level | `cli.py` (thin command dispatcher), `__init__.py` (entry point `main`) |

New in Sprint 06: `learning/` (episodes, predictions, scoring) and `api/routers/learning.py`.

Allowed dependency direction: `api` -> `learning`, `validation`, `backtesting`, `ingestion` -> `market` -> `core`. `core` imports nothing from the other packages. `cli.py` may import anything (lazily, inside commands).

`tests/` mirrors the packages (`tests/core`, `tests/ingestion`, ...) and `scripts/` is split into `scripts/db/` (migrations, database setup, reproduction) and `scripts/reports/` (generated documents).

The single-reader rule is enforced by path: only `market/read.py`, `ingestion/load.py` and `ingestion/quality.py` may run SQL on `market.bar_daily` (`tests/market/test_replay_and_reads.py`; a file with the same name in another package is flagged).

Public names: `market_data.api:app` (uvicorn target), `market-data` console script and `python -m market_data.cli` are unchanged. The OpenAPI document changed only in two schema names that embed Python module paths (the two `CausalityRequest` models).

## How it was done
An AST-based script rewrote every import (including relative and function-level ones) before the files were moved with `git mv` (history preserved). The full suite passed unchanged in count (314) before and after.

## Alternatives
One package per feature (vertical slices) was rejected for now: the code is small and the layers (data, research, API) are the useful boundaries. Splitting into several installable distributions was rejected as unnecessary operational weight (blueprint Section 24: keep it simple).

## Consequences
Older ADRs, sprint notes and generated pages mention the flat paths; this table maps them. `docs/02-domain/*.md` and the service README were updated; ADRs and sprint folders are left as historical records.
