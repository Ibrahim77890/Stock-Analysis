# Indexing for cross-sectional queries

**Sprint:** 02    **Used by tasks:** 02_01

## Why this matters for MarketLab
Sprint 01's benchmark showed that "one symbol, one year" is fast with only the primary key, but "all symbols on one date" took 1.3 to 2.3 seconds at 12.6M rows. Screens that rank all symbols on a date (movers, cross-sectional strategies) need that query. Whether a second index fixes it, and what it costs on load speed and size, is a measurement the project still owes.

## Plain-language explanation
A B-tree index on `(instrument_id, trade_date, source)` is sorted by instrument first. Finding one date across all instruments cannot jump to a range; PostgreSQL probes the index once per instrument (about 5,000 probes in the benchmark plan). An index that **leads with the date**, such as `(trade_date, instrument_id)`, keeps all rows of one date next to each other, so one range scan returns them.

Trade-offs: each extra index adds disk space (the primary key was about 0.5 GB for 12.6M rows) and slows inserts (every row updates every index). Build it **after** a bulk load (`CREATE INDEX`) when you can, and measure with `EXPLAIN (ANALYZE, BUFFERS)` and the same 200-query protocol.

Also relevant: `INCLUDE (close)` columns allow *index-only scans* if the visibility map is current (run `VACUUM`), and BRIN indexes are tiny but only help when physical row order follows the column.

## Key terms
- Multicolumn B-tree and leading column
- Index scan, index-only scan, bitmap scan, sequential scan
- Covering index (`INCLUDE`), visibility map, `VACUUM`
- BRIN, partitioning (not needed unless the measurement says so)

## Common mistakes / pitfalls
- Adding the index and not re-running the benchmark with identical seeds and warm-up.
- Comparing a cold run with a warm run.
- Forgetting the cost side: load throughput and size must be reported too.
- Trusting the planner's estimates (`cost=`) instead of actual times.
- Changing two things between runs (index and settings).

## What to implement in this domain
- On the `bench` schema only: create `(trade_date, instrument_id)` (optionally `INCLUDE (close)`), re-run W3 and the other workloads with the same seed, save `EXPLAIN (ANALYZE, BUFFERS)`.
- Record size of the new index and the load throughput with and without it.
- Decide, with numbers, whether the real `market.bar_daily` gets a migration for the index (record the answer in an ADR note).

## How to check you understood
1. Why does the primary key not serve "all symbols on 2020-08-31" well? (`trade_date` is not its leading column.)
2. Name one cost of the new index. (More disk and slower inserts.)
3. Which two runs may be compared? (Same seed, same workload, same cache state.)

## References
- [PostgreSQL: Multicolumn indexes](https://www.postgresql.org/docs/current/indexes-multicolumn.html): leading-column rule.
- [PostgreSQL: Index-only scans and covering indexes](https://www.postgresql.org/docs/current/indexes-index-only-scans.html): `INCLUDE` and visibility map.
- [PostgreSQL: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html): reading actual times and buffers.
- [PostgreSQL: BRIN indexes](https://www.postgresql.org/docs/current/brin.html): when physical ordering makes them tiny and useful.
- `docs/03-benchmarks/benchmark-01-postgres-daily-bars.md`: the Sprint 01 baseline to compare against.
