# Sprint 01: Trustworthy daily bars in PostgreSQL

## Goals
- Fix the project vocabulary and column-level data dictionary before writing schema code.
- Download raw US daily bars and corporate actions for a ~50-symbol universe, with provenance manifests.
- Load them idempotently into PostgreSQL (raw prices, separate corporate actions, quarantine for bad rows).
- Produce a calendar-aware data-quality report.
- Measure PostgreSQL range-query behaviour at ~12.6M synthetic rows.

## Why this sprint now
`current_status.md` is empty: nothing exists. The blueprint (Part II, 26.4) orders domain and data foundation first, because replay, indicators and backtests all depend on correct, trustworthy bars.

## Learning concepts (read before the tasks that cite them)
1. [OHLCV and candles](concepts/01_01_ohlcv-and-candles.md)
2. [Sessions, calendars and time](concepts/01_02_sessions-calendars-and-time.md)
3. [Corporate actions and adjusted prices](concepts/01_03_corporate-actions-and-adjusted-prices.md)
4. [Data provenance and licensing](concepts/01_04_data-provenance-and-licensing.md)
5. [Idempotent ingestion and Parquet](concepts/01_05_idempotent-ingestion-and-parquet.md)
6. [Data-quality validation](concepts/01_06_data-quality-validation.md)
7. [PostgreSQL schema for time-series](concepts/01_07_postgres-time-series-schema-and-indexing.md)
8. [Benchmarking methodology](concepts/01_08_benchmarking-methodology.md)

## Tasks (in order)
| ID | Title | Depends on |
|---|---|---|
| [01_01](tasks/01_01_task.md) | Choose layout; local Postgres + Python env | none |
| [01_02](tasks/01_02_task.md) | Glossary and data-dictionary skeleton | 01_01 |
| [01_03](tasks/01_03_task.md) | Universe and data-source terms | 01_02 |
| [01_04](tasks/01_04_task.md) | Download raw bars and corporate actions + manifests | 01_01, 01_03 |
| [01_05](tasks/01_05_task.md) | Explore and profile raw data | 01_04 |
| [01_06](tasks/01_06_task.md) | PostgreSQL schema via migrations | 01_01, 01_02, 01_05 |
| [01_07](tasks/01_07_task.md) | Idempotent loader with quarantine | 01_04, 01_06 |
| [01_08](tasks/01_08_task.md) | Quality rules, gap classification, report | 01_07 |
| [01_09](tasks/01_09_task.md) | Range query + 12.6M-row benchmark | 01_06, 01_07 |
| [01_10](tasks/01_10_task.md) | ADRs, docs, close sprint | all |

## Out of scope / deferred
- Intraday bars, fundamentals (SEC), delisted symbols and survivorship demo.
- NestJS, frontend, charts, replay API (only the `max_date` cap is prepared in 01_09).
- DuckDB / ClickHouse comparison, 100M-trade benchmark, partitioning (unless 01_09 justifies it).
- Indicators and backtesting.

## Definition of done
All acceptance criteria in tasks 01_01-01_10 pass (or unfinished items are in `pending/` with reasons), tests pass, the benchmark report and quality report exist, and ADRs are written.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 01 and plan the next one."
