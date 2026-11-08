# Benchmark 01: PostgreSQL daily-bar range queries at ~12.6M rows

All numbers below were measured on this machine by `market-data bench-*`; none are claims about other hardware.

## Environment

- OS: Windows-11-10.0.26300-SP0
- CPU: Intel64 Family 6 Model 140 Stepping 1, GenuineIntel (8 logical)
- RAM: 7.7 GiB
- Disk: INTEL SSDPEKNU512GZH (512 GB NVMe SSD)
- PostgreSQL: 18.6
- Settings (current values; check `postgresql.conf` for what was changed): effective_cache_size=5242888kB, max_parallel_workers_per_gather=2, random_page_cost=4, shared_buffers=163848kB, synchronous_commit=on, work_mem=4096kB

## Dataset

Synthetic geometric random walk, seed 20260101, 5000 symbols x 2520 sessions = 12,600,000 rows (log-return N(0.0003, 0.02), open gap N(0, 0.005), high/low wick |N(0, 0.01)|, volume lognormal(13, 1)). Table `bench.bar_daily`, same columns/constraints as `market.bar_daily` minus foreign keys; primary key (instrument_id, trade_date, source). Parameters live in `src/market_data/synthetic.py`.

## Load and size

- Load: 12,600,000 rows in 174.7 s = 72,144 rows/s (COPY, primary-key index maintained during load)
- Table size: 1,119 MiB; index size: 487 MiB; total: 1,607 MiB

## Query latency (200 random queries per workload)

| Workload | Run | p50 ms | p95 ms | p99 ms | mean ms |
|---|---|---|---|---|---|
| W1_one_symbol_one_year | warm (20 warm-up queries) | 4.828 | 6.68 | 7.196 | 4.802 |
| W2_one_symbol_full_history | warm (20 warm-up queries) | 22.395 | 32.334 | 42.842 | 23.703 |
| W3_cross_section_one_date | warm (20 warm-up queries) | 2275.812 | 3663.121 | 4519.831 | 2073.07 |
| W4_20_symbols_one_year | warm (20 warm-up queries) | 55.574 | 86.663 | 108.975 | 58.958 |

_Cold run not recorded: restart PostgreSQL, then run `bench-run --cold`._

## EXPLAIN (ANALYZE, BUFFERS) excerpts (warm run)

### W1_one_symbol_one_year: plan uses an index scan on the primary key

```
Index Scan using bar_daily_pkey on bar_daily  (cost=0.43..1626.04 rows=257 width=40) (actual time=1.113..2.449 rows=260.00 loops=1)
  Index Cond: ((instrument_id = '3120'::smallint) AND (trade_date >= '2022-01-01'::date) AND (trade_date <= '2022-12-31'::date) AND (source = 'synthetic'::text))
  Index Searches: 1
  Buffers: shared hit=2 read=6
Planning Time: 0.492 ms
Execution Time: 2.536 ms
```

### W3_cross_section_one_date: plan uses an index scan on the primary key

```
Index Scan using bar_daily_pkey on bar_daily  (cost=0.43..29886.37 rows=4976 width=15) (actual time=0.707..2158.456 rows=5000.00 loops=1)
  Index Cond: ((trade_date = '2022-05-06'::date) AND (source = 'synthetic'::text))
  Index Searches: 5002
  Buffers: shared hit=10499 read=9507
Planning Time: 0.360 ms
Execution Time: 2161.483 ms
```

## Conclusion

Measured on this machine only (8 logical CPUs, 7.7 GiB RAM, PostgreSQL 18.6 on Windows, default settings, warm runs). There is no true cold run: restarting the service needs administrator rights, which the session did not have.

- Per-symbol queries (W1, W2, W4) are fast with only the primary key (instrument_id, trade_date, source): p95 at or below about 90 ms at 12.6M rows.
- The cross-section query (W3, all symbols on one date) is the weak spot: p50 1.3 s and 2.3 s, p95 3.8 s and 3.7 s in two warm runs. Its plan uses the primary-key index with about 5,000 separate probes (one per symbol), because trade_date is not the leading column.
- The two warm runs differ noticeably (W3 p50 1,321 vs 2,276 ms; W4 p50 32 vs 56 ms) while other processes were running, so treat the numbers as orders of magnitude, not precise figures.
- Partitioning or BRIN justified by these numbers? **No.** The slow case is a query shape (date-leading access), not table size. First thing to test next: a secondary index on (trade_date, instrument_id) and its cost on load throughput. Also: a real cold-cache run (restart PostgreSQL, then `bench-run --cold`), concurrent clients, wider IN lists.
- The load ran with the primary key in place (72,144 rows/s); loading first and indexing afterwards was not tested.

## Index experiment (Sprint 02, task 02_01)

Same machine, same synthetic data, same seed (1) and protocol (20 warm-up + 200 timed queries per workload, warm). Index: `CREATE INDEX bench_bar_daily_date_idx ON bench.bar_daily (trade_date, instrument_id) INCLUDE (close)`, built after the load (`VACUUM ANALYZE` before and after). Source files: `data/reports/bench/run_baseline2.json`, `run_indexed.json`, `index_build.json`, `load.json`, `load_with_date_index.json`.

| Workload | Without index p50 / p95 ms | With index p50 / p95 ms |
|---|---|---|
| W1 one symbol, one year | 4.4 / 6.2 | 2.6 / 4.3 |
| W2 one symbol, full history | 18.8 / 28.3 | 13.0 / 20.2 |
| W3 all symbols, one date | 523.6 / 2,197.9 | 86.0 / 184.4 |
| W4 20 symbols, one year | 18.2 / 29.2 | 25.0 / 36.1 |

- W3 plan changed from an index scan on the primary key (about 5,000 probes; `Execution Time: 136 ms` in the single EXPLAIN run) to a Bitmap Heap Scan on the new index (`Execution Time: 80 ms` in the single EXPLAIN run).
- Cost: building it after the load took 17.8 s and the index is 511,025,152 bytes (the table is 1,173,454,848 bytes). Creating it **before** the load made the two indexes together 1,423,745,024 bytes, i.e. the date index was about 912 MB when built incrementally, and load throughput fell from 72,144 to 60,410 rows/s (-16%; 174.7 s to 208.6 s).
- Noise: the earlier Sprint 01 warm runs gave W3 p50 of 1,321 ms and 2,276 ms; this baseline gave 524 ms for the same workload without the index, so run-to-run differences without any change are larger than 2x. The index effect on W3 (6x at p50, 12x at p95 here) is larger than that noise, but W1, W2 and W4 differences are within it.
- Decision (task 02_01 step 7): **do not add the index to `market.bar_daily` now** (no migration `0007`). The real table has 72,314 rows, where a one-date query is trivial; the index is useful at the 12.6M-row scale. Revisit if the universe grows to thousands of symbols or a cross-sectional screen is built; then create the index after a bulk load. Partitioning and BRIN are still not justified by these measurements.
- Still open: a true cold-cache run (restarting the PostgreSQL service needs administrator rights).
