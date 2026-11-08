# Benchmarking methodology

**Sprint:** 01    **Used by tasks:** 01_09

## Why this matters for MarketLab
The blueprint forbids unmeasured performance claims. A benchmark is only credible if it is repeatable, states its environment, and reports percentiles rather than a single lucky run.

## Plain-language explanation
A good benchmark states: **dataset** (rows, how generated), **hardware/software** (CPU, RAM, disk, PostgreSQL version, config), **workload** (exact queries), **method** (warm-up runs, number of repetitions), and **metrics** (throughput rows/s, latency p50/p95/p99, table + index size). Run each query N times (e.g. 100 with random parameters), discard warm-up, report percentiles. Distinguish **cold cache** (first run) from **warm cache**.

Synthetic data is the right tool when you need size without licensing issues: seeded random-walk prices make the benchmark reproducible by anyone.

Example result line: "Range query, 1 symbol x 1 year, 12.6M-row table, warm: p50 2.1 ms, p95 4.0 ms (n=200; i7, 32 GB, NVMe, PG 16)." (Illustrative format, not a result.)

## Key terms
Throughput, latency percentile (p50/p95/p99), cold vs warm cache, warm-up, seed, workload, outlier.

## Common mistakes / pitfalls
- Reporting the mean or the best run.
- Not saying the hardware.
- Timing the client's printing/formatting rather than the query.
- Changing two things between runs.

## What to implement in this domain
- A seeded synthetic bar generator (geometric random walk) writing Parquet (task 01_09).
- A benchmark script that loads it, runs N random range queries, and writes a results markdown with environment info (task 01_09).

## How to check you understood
1. Why are p95/p99 reported in addition to p50? (Tail latency is what users feel on slow requests.)
2. Two runs differ 3x. List three possible causes. (Cache state, background load, different plan.)

## References
- [PostgreSQL: Using EXPLAIN](https://www.postgresql.org/docs/current/using-explain.html)
- [NumPy random Generator](https://numpy.org/doc/stable/reference/random/generator.html) (unverified): seeded reproducible RNG.
- [Python `time.perf_counter`](https://docs.python.org/3/library/time.html): monotonic high-resolution timer.
- Blueprint section 13 (local).
