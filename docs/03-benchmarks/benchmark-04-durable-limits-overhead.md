# Benchmark 04: what the durable limiter and trace cost

Measured 2026-11-10 by `apps/api/scripts/bench-sprint08.ts` (`npm run bench:sprint08`).

**Machine:** 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz (8 threads), 8 GB RAM, Windows_NT 10.0.26300, node v20.19.0, PostgreSQL on localhost, git 5bfdbfe (working tree).

**Method:** 200 sequential calls after 10 warm-up calls, one process, the real `marketlab` database on the same machine.
The limiter is timed directly (one `allow` call). The trace is timed through `GET /lab/studies` (a call that touches only the gateway database) against two in-process gateways: one with the durable trace (a row written to `app.request_log` after the reply) and one with the old in-memory trace.

| What | p50 ms | p95 ms | max ms |
|---|---|---|---|
| Limiter, in memory (old) | 0.01 | 0.01 | 0.07 |
| Limiter, PostgreSQL (new; one transaction with an advisory lock) | 3.10 | 4.86 | 7.21 |
| `GET /lab/studies`, in-memory trace (old) | 4.07 | 6.65 | 8.94 |
| `GET /lab/studies`, durable trace (new) | 5.67 | 9.79 | 15.95 |

**Reading:** the database limiter adds about 3.09 ms at the median per limited call. Only login, Lab runs, vault tries and lesson answers use it. The trace write happens after the reply is sent, so it adds 1.59 ms at the median to the measured call (the difference is within normal noise when it is small).

**What this does not show:** many learners at once, a database on another machine, or a cold cache. The numbers are for one machine, one learner, one process. No target was set before measuring.
