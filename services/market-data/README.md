# market-data

Python service of MarketLab: downloads, validates, stores and serves historical market data.
It **owns the `market` schema** in PostgreSQL (only this service migrates or writes it).

## Setup (once)

```bash
# 1. Secrets/config (repository root)
cp ../../.env.example ../../.env      # then edit passwords if you like

# 2. Python environment (Python 3.14, managed by uv)
uv sync

# 3. One-time: create the role and database on your local PostgreSQL service
#    (needs sudo to act as the `postgres` superuser; idempotent)
uv run poe db-init

# 4. Create/upgrade tables
uv run poe migration-run
```

PostgreSQL runs as a normal system service (no Docker) on **localhost:5432**. `db-init` creates the role
`marketlab` and database `marketlab` using the password from `POSTGRES_PASSWORD` in `.env`; `DATABASE_URL`
in `.env` must match. Check the service with `uv run poe db-check`.

## Migrations (Alembic, hand-written)

Migrations are numbered `0001`, `0002`, ... and live in `migrations/versions/`.
We write them by hand (plain SQL through `op.execute`); autogenerate is not used because there are
no ORM models.

| Command | What it does |
|---|---|
| `uv run poe migration-new create instrument table` | Creates the next numbered file, e.g. `0003_create_instrument_table.py`, linked to the current head |
| `uv run poe migration-run` | Applies all pending migrations |
| `uv run poe migration-rollback` | Undoes the latest migration |
| `uv run poe migration-current` | Shows which revision the database is at |
| `uv run poe migration-history` | Lists all migrations |
| `uv run poe migration-heads` | Must show exactly one head; two heads mean a branch conflict |
| `uv run poe migration-sql` | Prints the SQL of pending migrations without running it |

Workflow for a schema change:

1. `uv run poe migration-new <short description>`
2. Open the new file; write `upgrade()` and the matching `downgrade()` using `op.execute("...")`,
   always with the `market.` prefix.
3. `uv run poe migration-run`, check with `uv run poe db-psql`, then `migration-rollback` and
   `migration-run` again to prove the downgrade works.
4. Never edit a migration that has already been applied elsewhere; add a new one.

Alembic's version table is `market.alembic_version`, so nothing is created outside the `market` schema.

## How to reproduce Sprints 1 to 7 (from an empty machine)

Run from `services/market-data`. Steps marked (needs keys) need `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` (Sprint 1) or `TIINGO_API_KEY`/`FRED_API_KEY` (Sprint 5) in the git-ignored `.env`; `uv run market-data check-keys [--ping]` reports which keys are set without printing them.

```bash
uv sync                                   # Python 3.14 environment
uv run poe db-init                        # once: role + database (on Windows run scripts/db/db_init.sql with psql as the postgres user)
uv run poe migration-run                  # creates schema market + 6 tables
uv run poe test                           # unit tests; DB tests are skipped unless TEST_DATABASE_URL is set
uv run market-data download               # (needs keys) raw bars + corporate actions + manifests into ../../data/raw
uv run market-data verify                 # every raw file matches its manifest hash
uv run python scripts/reports/profile_raw.py      # writes docs/02-domain/data-profile-v1.md
uv run market-data load                   # idempotent load; run twice, second run reports 0 inserted/updated
uv run market-data quality --run          # writes data/reports/quality-report-<run_id>.md/.json
uv run market-data bench-generate         # 5000 symbols x 2520 sessions, seeded -> data/synthetic
uv run market-data bench-load             # schema bench (separate from market)
uv run market-data bench-run              # warm; restart PostgreSQL, then: bench-run --cold
uv run market-data bench-report           # writes docs/03-benchmarks/benchmark-01-postgres-daily-bars.md
uv run market-data bench-index-experiment # Sprint 02: effect of a (trade_date, instrument_id) index (long)
uv run python scripts/reports/window_audit.py     # Sprint 04: per-symbol bar counts into data-profile-v1.md
uv run python scripts/reports/validation_worked_example.py  # Sprint 04: search, split, walk-forward, DSR, scan, regimes (writes studies; about 1 minute)
uv run python scripts/reports/backtest_worked_example.py  # Sprint 03: real-data backtest example + saved runs (needs loaded data and migration 0007)
uv run market-data check-keys --ping     # Sprint 05: which keys are set (never printed) and whether the vendors accept them
uv run market-data tiingo-download        # (needs TIINGO_API_KEY) at most 45 requests per run; rerun about an hour later until 'remaining' is 0 (exit code 3 = quota reached, nothing lost)
uv run market-data tiingo-load            # raw Tiingo files -> source='tiingo' (idempotent; run twice, second run inserts 0)
uv run market-data fred-download          # (needs FRED_API_KEY) DGS3MO and VIXCLS raw files (migration 0009 first: uv run poe migration-run)
uv run market-data fred-load              # idempotent load into market.macro_observation
uv run market-data quality --run --source tiingo   # data-quality rules on the second source
uv run market-data reconcile              # Alpaca vs Tiingo report under ../../data/reports/ (ADR 0013, Appendix A tolerances)
uv run python scripts/reports/price_basis_table.py        # Sprint 05: split vs split+dividend table into backtest.md
uv run python scripts/reports/long_window_example.py      # Sprint 05: 21-year validation page (about 2 minutes; writes studies)
uv run market-data serve                  # Sprint 06: Swagger now has a 'Learning' section (internal: the gateway calls it)
# Sprint 06 also needs the gateway and the web app: see docs/02-domain/system-overview.md ("Start everything")
uv run market-data export-openapi         # refresh docs/02-domain/openapi-market-data.json (a test compares it)
uv run market-data serve                  # HTTP API + Swagger UI: http://127.0.0.1:8000/docs
```

### Swagger UI: test every function by hand

Open http://127.0.0.1:8000/docs (binds to 127.0.0.1 only; no authentication). Sections:

| Section | What you can try |
|---|---|
| Reference | `/health`, `/instruments`, `/universe`, `/corporate-actions` |
| Bars | `GET /bars`: symbol, dates, `adjustment` (raw/split/split_dividend), `cursor`, `indicators=sma:20,ema:50` |
| Adjustment | `POST /adjust/preview`: your own bars + actions + as_of (prefilled 4-for-1 example, no database) |
| Indicators | `POST /indicators/compute` (your closes), `GET /indicators/{symbol}`, `POST /indicators/causality-check` (try `leaky_centered_sma:5`) |
| Replay | open a session, advance the cursor, get bars (`blind=true` hides symbol and dates) |
| Lineage | `GET /lineage/{symbol}`: provider, feed, manifest hash, jobs, quality counts, caveats |
| Data quality | stored results, `POST /quality/rules/check` (your bars), `POST /quality/run` (writes) |
| Ingestion | job history, quarantine, raw files, `verify`; `download` (needs Alpaca keys) and `load` write data |
| Benchmark | stored benchmark results |
| Learning | **Internal (called by the NestJS gateway, never by the browser).** `POST /episodes` (blind episode; **writes**), `POST /episodes/states` (public state of several), `GET /episodes/{id}`, `/bars` (blind: day numbers, price starts at 100, relative volume), `POST /advance` (**writes**; resolves due guesses), `POST|GET /predictions` (**writes**; append-only), `GET /score` (Brier, calibration, luck check), `POST /reveal` (**writes**; one way, shows identity and data trail), `GET|POST /learning/summary`. With `INTERNAL_API_TOKEN` set every call needs the header `X-Internal-Token`. |
| Indicators (episodes) | **Internal (called by the NestJS gateway).** `GET /episodes/{id}/indicators?name=sma\|ema\|rsi&window=` (days already visible only; numbers, no dates or symbols). |
| Paper | **Internal (called by the NestJS gateway).** `POST /episodes/{id}/decisions` (**writes**; append-only, idempotent by client key), `GET /episodes/{id}/decisions` (results so far and totals). |
| Lab | **Internal (called by the NestJS gateway).** `GET /lab/stocks`, `POST /lab/studies` (**writes**; a study with a locked vault), `POST /lab/studies/info`, `GET /lab/studies/{id}` (ideas tried; never vault dates), `POST /lab/studies/{id}/runs` (**writes** a counted trial; a repeat is recomputed, not counted), `POST /lab/studies/{id}/vault` (**writes**; one use, 409 on a second call), `GET /lab/studies/{id}/vault` (the saved result). With `INTERNAL_API_TOKEN` set every call needs `X-Internal-Token`. Limits: 2 <= fast < slow <= 300, cost 0 to 50 bps, 10 to 200 mixed-up histories, 200 trials per study. |
| Sources | `GET /sources` (per source: symbols, bars, dates, action counts; macro series), `GET /sources/keys?ping=` (presence only), `POST /sources/reconcile` (Alpaca vs Tiingo; `write_report` writes a file), `GET /sources/adjustment-check/{symbol}` (our split+dividend close vs the vendor's), `POST /ingestion/tiingo/download` (**calls the vendor**, `max_requests` default 45, 429 on quota, 400 if the key is missing) and `POST /ingestion/tiingo/load` (**writes** `market.*`) |
| Macro | `GET /macro/{series_id}` (DGS3MO, VIXCLS; null = no value that day), `GET /macro/{series_id}/asof?date=&strict=` (404 before the first observation), `GET /macro/derived/risk-free?date=`, `GET /macro/derived/vix-bucket?date=`, `POST /ingestion/fred/download` (**calls the vendor**) and `POST /ingestion/fred/load` (**writes** `market.macro_observation`). This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis. |
| Validation | `POST /validation/grid-search` (`record=true` stores each pair as a trial), `/validation/split-evaluation`, `/validation/holdout` (one use per study, 409 on a second call), `/validation/walk-forward`, `/validation/sharpe-stats` (your own returns, no database), `GET /validation/studies` and `/studies/{id}` (with the overfitting meter), `/validation/universe-scan`, `/validation/best-of-n`, `/validation/regimes` |
| Backtest | `POST /backtests/simulate` (your bars, prefilled golden example), `/backtests/metrics` (your equity values), `/backtests/run` (database bars, `persist=true` saves with hashes), `/backtests/fill-model-comparison` (look-ahead detector), `/backtests/cost-sweep`, `/backtests/shuffle-test`, `/backtests/causality-check`, `GET /backtests`, `/backtests/{id}`, `/{id}/trades`, `/{id}/equity`, `POST /{id}/reproduce` |

Sprint 03 (backtest): `uv run poe migration-run` applies `0007` (schema `research`). Try in Swagger: `POST /backtests/run` with the default body (AAPL 5/20, from 2020-07-27) and `persist: true`, run it twice (same `run_id`, `created: false`), then `POST /backtests/{run_id}/reproduce` (expect `reproduced`). Model, metrics and limits: `docs/02-domain/backtest.md`; real numbers: `docs/02-domain/backtest-worked-example.md`. Only `persist=true` writes (to `research.*`).

Sprint 04 (validation): `uv run poe migration-run` applies `0008` (`research.study`, `research.trial`). Try in Swagger: `POST /validation/grid-search` with `record: true` twice (two studies, trials counted), `GET /validation/studies/{id}` for the overfitting meter, `POST /validation/split-evaluation` with `record: true`, then `POST /validation/holdout` for that study twice (second call returns 409). Method, formulas and limits: `docs/02-domain/validation.md`; real numbers: `docs/02-domain/validation-worked-example.md`. Data window: the contiguous window of the whole universe is 2020-07-27 to 2025-12-31 (see the audit table in `docs/02-domain/data-profile-v1.md`).

Sprint 05 (second source, total return, risk-free rate): `uv run poe migration-run` applies `0009` (`market.macro_observation`). Keys: put `TIINGO_API_KEY` (free account, Starter plan: 50 requests/hour, 1,000/day, 500 symbols/month, **internal use only**) and `FRED_API_KEY` (free, https://fred.stlouisfed.org/docs/api/api_key.html) in `.env` (placeholders are in `.env.example`; `.env` is git-ignored and the code never prints a key). **Two-run download procedure:** the universe is 53 symbols and one request is made per symbol, so `uv run market-data tiingo-download` stops after 45 requests; run it again after the hourly window has passed (the first run's files are kept and skipped) until it reports `remaining: 0`. A 429 from the vendor stops the run with exit code 3 and the message "quota reached; rerun later". Then `tiingo-load`, `fred-download`, `fred-load`, `reconcile`. In Swagger, `POST /backtests/run` and the validation endpoints take `source` (alpaca | tiingo), `price_basis` (split | split_dividend) and `risk_free` (adds `sharpe_excess`); the defaults leave every earlier response unchanged. Policy: `docs/04-adr/0013-second-source-and-macro-policy.md`; real results: `docs/02-domain/long-window-example.md`. The raw data and the database stay on this machine (licence: internal use only); the reports contain only derived statistics.

Sprint 06 (learning loop): `uv run poe migration-run` applies `0010` (`research.episode`) and `0011` (`research.prediction` with its append-only trigger). In Swagger try `POST /episodes` (`kind: synthetic`, `seed: 1`), `GET /episodes/{id}/bars`, `POST /episodes/{id}/predictions` (horizon 1, p_up 0.7), `POST /episodes/{id}/advance`, `GET /episodes/{id}/score`, then `POST /episodes/{id}/reveal` twice (the second answer is identical). Protocol: `docs/04-adr/0015-blind-episode-and-prediction-protocol.md`; scoring: `docs/02-domain/scoring.md`. **Run MarketLab (three terminals):** this service (`serve`), the gateway (`apps/api`: `npm start`) and the web app (`apps/web`: `npm run dev`, http://127.0.0.1:5173); details and secrets in `docs/02-domain/system-overview.md`. The package layout is explained in the Layout section below and in ADR 0016.

Sprint 07 (Strategy Lab): `uv run poe migration-run` applies `0012` (`research.lab_study`). In Swagger try `POST /lab/studies` (`{"symbol": "AAPL"}`), `POST /lab/studies/{id}/runs` (`fast` 20, `slow` 100) twice (the second answer says `counted: false`), `GET /lab/studies/{id}`, then `POST /lab/studies/{id}/vault` once with the same rule and again (409). Design: `docs/04-adr/0017-strategy-lab-practice-window-and-vault.md`; what the page shows: `docs/02-domain/lab.md`. Timing: `docs/03-benchmarks/benchmark-03-lab-run-latency.md`.

Environment note: `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` in `.env` are only needed by `download`, `TIINGO_API_KEY` by `tiingo-download` and `FRED_API_KEY` by `fred-download`. Nothing else needs credentials besides the PostgreSQL login in `DATABASE_URL`.

Database tests: create a throwaway database, set `TEST_DATABASE_URL=postgresql://...` and run `uv run poe test`
(the fixture runs `alembic downgrade base` then `upgrade head` on it, so never point it at real data).

## Other tasks

`uv run poe` lists every task: `test`, `test-coverage`, `db-init`, `db-check`, `db-psql`, ...

## Layout

```
services/market-data/
├── pyproject.toml            dependencies, poe tasks, entry point `market-data`
├── alembic.ini
├── migrations/               env.py, script.py.mako, versions/NNNN_*.py (hand-written SQL)
├── config/                   universe_v1.csv
├── scripts/
│   ├── db/                   new_migration.py, db_init.sql, fresh_db_repro.py
│   └── reports/              profile_raw, window_audit, *_worked_example, price_basis_table, long_window_example
├── src/market_data/
│   ├── cli.py                `market-data <command>` (thin: parses arguments, calls the packages below)
│   ├── core/                 config, keys, manifest, universe (no database, no network except keys ping)
│   ├── ingestion/            download, download_tiingo, load, macro, quality (files in, `market.*` rows out)
│   ├── market/               read (the only reader of bars), adjust, adjust_check, replay, indicators, lineage,
│   │                         reconcile, synthetic (as-of reads and checks on `market.*`)
│   ├── backtesting/          backtest, metrics, luck, research (engine, metrics, controls, saved runs)
│   ├── validation/           protocol (studies, splits, walk-forward), sharpe_stats, scan, regimes
│   ├── learning/             episode (blind episodes, guesses, reveal), scoring (pure functions)
│   ├── api/                  app.py (FastAPI app, Reference/Bars/Replay/... routes), routers/ (backtest, sources, validation, learning)
│   └── bench/                benchmark (Sprint 01/02 PostgreSQL benchmark)
└── tests/                    mirrors the packages: core/, ingestion/, market/, backtesting/, validation/, api/
```

Rules of the layout (ADR 0016): dependencies point downwards only (`api` -> `validation`/`backtesting` -> `market` -> `core`;
`ingestion` -> `market`/`core`); only `market/read.py`, `ingestion/load.py` and `ingestion/quality.py` run SQL on
`market.bar_daily` (a structural test enforces it); packages mirror database ownership (`market`, `research`).

Repository-level file used by this service: `../../.env` (loaded by poe and by `migrations/env.py`).
