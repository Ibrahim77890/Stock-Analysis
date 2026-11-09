# Benchmark 03: Strategy Lab run latency (generated 2026-11-09T12:22 UTC)

Produced by `services/market-data/scripts/reports/lab_benchmark.py`. Informational: measurements on one machine with warm caches, not targets and not promises.

**What was measured.** One run is `POST /lab/studies/{id}/runs`: the rule and buy and hold on the 17-year practice window of AAPL (4,278 daily bars), a cost table at five levels, the luck check with block-bootstrap paths, the trial record and the overfitting meter. 'Direct function' calls `run_practice` inside Python (no HTTP). 'Python HTTP' sends the internal token to the service. 'Gateway' is the browser path (sign-in token, ownership check, validation, rate limit, whitelisting, trace). A first call per case is discarded; the repeated rule is recomputed each time (not counted again).

**Machine.** Windows 11, 8 logical CPUs, Python 3.14.10, local PostgreSQL. Other programs were running (the web dev server and the browser), so treat small differences as noise.

| Run | Path | Calls | p50 s | p95 s | max s |
|---|---|---|---|---|---|
| typical: slow 50, 100 mixed-up histories | direct function | 20 | 2.36 | 2.68 | 2.93 |
| largest allowed: slow 300, 200 mixed-up histories | direct function | 20 | 4.13 | 5.10 | 5.30 |
| typical: slow 50, 100 mixed-up histories | Python HTTP | 10 | 2.70 | 3.37 | 3.37 |
| typical: slow 50, 100 mixed-up histories | gateway | 10 | 2.67 | 3.08 | 3.08 |
| largest allowed: slow 300, 200 mixed-up histories | Python HTTP | 8 | 4.38 | 5.18 | 5.18 |
| largest allowed: slow 300, 200 mixed-up histories | gateway | 8 | 4.43 | 5.50 | 5.50 |

**Cheap read (`GET /lab/studies/{id}`), 30 interleaved calls.**

| Path | p50 ms | p95 ms | max ms |
|---|---|---|---|
| Python HTTP | 118.1 | 271.8 | 297.4 |
| gateway | 149.3 | 271.2 | 327.7 |

**Response size.** typical: slow 50, 100 mixed-up histories: 11.3 KB; largest allowed: slow 300, 200 mixed-up histories: 11.5 KB (the equity curves are cut to at most 300 points).

**What this does not show.** One machine, one stock, warm database and file caches, one user at a time. It says nothing about many people using the Lab together. The run time is dominated by the luck check (one backtest per mixed-up history), so it grows roughly with the number of mixed-up histories and with the length of the window.

**Left in the real database by this run.** One learner `lab-bench-6af1b9fb` with one study, and two studies created directly in Python (study ids 49 and 50). They are anonymous test data.
