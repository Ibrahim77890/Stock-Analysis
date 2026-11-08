# PostgreSQL schema design for time-series bars

**Sprint:** 01    **Used by tasks:** 01_01, 01_06, 01_09

## Why this matters for MarketLab
PostgreSQL is the only database for now. A good schema and key design keeps the common query ("bars for symbol X between dates A and B") fast up to tens of millions of rows. You will also need data to defend or revise this choice later with measurement.

## Plain-language explanation
- **Schemas** are namespaces. Use `market` for market data (owned by the Python service), `app` for users/lessons (owned by NestJS). Only the owner writes or migrates its schema (blueprint 24).
- **Primary key** `(instrument_id, trade_date)` creates a B-tree index that serves symbol + date-range queries and enforces uniqueness at once.
- **Types**: `NUMERIC(18,6)` for prices (exact), `BIGINT` for volume, `DATE` for trading date, `TIMESTAMPTZ` for instants.
- **Migrations**: numbered, ordered change scripts (here: Alembic revisions `0001`, `0002`, ...) recorded in a version table, so the database can be rebuilt from scratch and every change can be undone with a `downgrade()`.
- **EXPLAIN (ANALYZE, BUFFERS)** shows whether a query uses the index and how long each step took.
- **BRIN** indexes and **partitioning** help for very large, naturally ordered tables. Don't add them until measurement shows a need (sprint task 01_09 produces that measurement).

## Key terms
- Schema, primary key, composite index, migration, `EXPLAIN ANALYZE`, sequential scan vs index scan, table bloat, partitioning, BRIN.

## Common mistakes / pitfalls
- `FLOAT` for prices (rounding error) or for money in general.
- Using the symbol string as a foreign key (symbols change).
- Adding indexes "just in case"; each one slows inserts.
- Benchmarking on tiny tables; plans change with size.

## What to implement in this domain
- Migrations creating `market.instrument`, `market.bar_daily`, `market.ingestion_job`, `market.bar_quarantine`, `market.corporate_action`, (Alembic keeps its own version table in `market`) (task 01_06).
- A read function/query for symbol + date range (task 01_09).
- `EXPLAIN ANALYZE` output saved in the benchmark report (task 01_09).

## How to check you understood
1. Which query uses the primary-key index: `WHERE instrument_id=7 AND trade_date BETWEEN ...` or `WHERE trade_date = ...` alone? (The first; the second filters on the second column only.)
2. Why `NUMERIC` and not `DOUBLE PRECISION` for prices? (Exact decimal arithmetic; no binary rounding surprises.)

## References
- [PostgreSQL: Index types](https://www.postgresql.org/docs/current/indexes-types.html)
- [PostgreSQL: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [PostgreSQL: Table partitioning](https://www.postgresql.org/docs/current/ddl-partitioning.html)
- [PostgreSQL: Numeric types](https://www.postgresql.org/docs/current/datatype-numeric.html)
- [PostgreSQL: Date/time types](https://www.postgresql.org/docs/current/datatype-datetime.html)
- [Docker Compose](https://docs.docker.com/compose/): run Postgres locally.
- [Alembic tutorial](https://alembic.sqlalchemy.org/en/latest/tutorial.html) (unverified): revisions, `upgrade`/`downgrade`, `op.execute`.
