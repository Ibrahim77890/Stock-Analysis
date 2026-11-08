# Idempotent ingestion, Parquet and upserts

**Sprint:** 01    **Used by tasks:** 01_04, 01_06, 01_07

## Why this matters for MarketLab
Loads fail halfway, get re-run, and overlap. A pipeline that creates duplicates when re-run is a pipeline you cannot trust. Idempotency (running it twice gives the same result as running it once) is a core engineering claim of the project.

## Plain-language explanation
Layers:
1. **Raw**: provider response saved as-is (Parquet or the provider's JSON/CSV) with a manifest.
2. **Normalized**: columns renamed/typed consistently (still a file, Parquet).
3. **Loaded**: rows in PostgreSQL.

**Parquet** is a column-oriented file format: compact, typed, fast to scan with Polars. **Upsert** means "insert, or if the key exists, update": in PostgreSQL `INSERT ... ON CONFLICT (key) DO UPDATE`. The **logical key** of a daily bar is `(instrument_id, trade_date)` plus, when you have multiple sources, `source`.

Example: loading the same 1,000-row file twice must leave exactly 1,000 rows. If the provider later revises a row, the second load updates it and the change is logged.

## Key terms
- **Logical (natural) key**, **upsert**, **idempotent**, **ingestion job** (a row recording start, end, status, counts, file hash), **quarantine** (rejected rows stored for review rather than dropped silently).

## Common mistakes / pitfalls
- Using `INSERT` without a unique constraint.
- Loading row by row (slow); use batches or `COPY`.
- Silently dropping bad rows.
- Not recording how many rows were inserted, updated, rejected.

## What to implement in this domain
- Reader: Parquet -> Polars DataFrame with an explicit schema (task 01_04, 01_07).
- Loader: batch upsert into `market.bar_daily` with `ON CONFLICT` and an `ingestion_job` row (task 01_07).
- Quarantine table for rejected rows with reason (task 01_07).

## How to check you understood
1. What happens to `INSERT ... ON CONFLICT DO NOTHING` vs `DO UPDATE` when a provider corrects a price? (DO NOTHING keeps the stale value.)
2. How could you prove idempotency in a test? (Load twice; compare row count and a checksum of all rows.)

## References
- [PostgreSQL: INSERT (ON CONFLICT)](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): unique and primary keys, check constraints.
- [Polars: Parquet I/O](https://docs.pola.rs/user-guide/io/parquet/)
- [Apache Parquet docs](https://parquet.apache.org/docs/): format overview.
- [Psycopg 3 docs](https://www.psycopg.org/psycopg3/docs/): `executemany`, `COPY`.
- Martin Kleppmann, *Designing Data-Intensive Applications* (O'Reilly, 2017): chapters on storage and on batch/stream processing explain idempotence and exactly-once semantics.
