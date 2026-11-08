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

## How to reproduce Sprints 1 and 2 (from an empty machine)

Run from `services/market-data`. Steps marked (needs keys) need `ALPACA_API_KEY_ID`/`ALPACA_API_SECRET_KEY` in `.env`.

```bash
uv sync                                   # Python 3.14 environment
uv run poe db-init                        # once: role + database (on Windows run scripts/db_init.sql with psql as the postgres user)
uv run poe migration-run                  # creates schema market + 6 tables
uv run poe test                           # unit tests; DB tests are skipped unless TEST_DATABASE_URL is set
uv run market-data download               # (needs keys) raw bars + corporate actions + manifests into ../../data/raw
uv run market-data verify                 # every raw file matches its manifest hash
uv run python scripts/profile_raw.py      # writes docs/02-domain/data-profile-v1.md
uv run market-data load                   # idempotent load; run twice, second run reports 0 inserted/updated
uv run market-data quality --run          # writes data/reports/quality-report-<run_id>.md/.json
uv run market-data bench-generate         # 5000 symbols x 2520 sessions, seeded -> data/synthetic
uv run market-data bench-load             # schema bench (separate from market)
uv run market-data bench-run              # warm; restart PostgreSQL, then: bench-run --cold
uv run market-data bench-report           # writes docs/03-benchmarks/benchmark-01-postgres-daily-bars.md
uv run market-data bench-index-experiment # Sprint 02: effect of a (trade_date, instrument_id) index (long)
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

Environment note: `ALPACA_API_KEY_ID` and `ALPACA_API_SECRET_KEY` in `.env` are only needed by `download`. Nothing else needs credentials besides the PostgreSQL login in `DATABASE_URL`.

Database tests: create a throwaway database, set `TEST_DATABASE_URL=postgresql://...` and run `uv run poe test`
(the fixture runs `alembic downgrade base` then `upgrade head` on it, so never point it at real data).

## Other tasks

`uv run poe` lists every task: `test`, `test-coverage`, `db-init`, `db-check`, `db-psql`, ...

## Layout

```
services/market-data/
├── pyproject.toml        dependencies, poe tasks
├── alembic.ini
├── migrations/           env.py, script.py.mako, versions/NNNN_*.py
├── scripts/              new_migration.py (numbered migration generator), db_init.sql
├── src/market_data/      package (download, load, quality, read ... added by sprint tasks)
└── tests/
```

Repository-level file used by this service: `../../.env` (loaded by poe and by `migrations/env.py`).
