# Benchmark 05: lessons latency

Measured 2026-11-10 by `apps/api/scripts/bench-sprint08.ts`.

**Machine:** 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz (8 threads), 8 GB RAM, Windows_NT 10.0.26300, node v20.19.0, PostgreSQL on localhost, git 5bfdbfe (working tree).

**Method:** 100 calls per row (answers: 100, spread over two throwaway learners because one learner may send 60 answers a minute), after 10 warm-up calls. "Through the gateway" is real HTTP to the running gateway with a signed-in learner. "Database only" is the main query of that route run directly with `pg`, to show how much time is the database and how much is the gateway. The throwaway learners were deleted afterwards.

| Route | Through the gateway p50 / p95 / max (ms) | Database only p50 / p95 / max (ms) |
|---|---|---|
| `GET /lessons` | 6.51 / 9.83 / 13.11 | 0.38 / 0.96 / 1.47 (simple query; the real route runs one larger query) |
| `GET /lessons/:slug` | 7.53 / 10.05 / 11.73 | 0.32 / 1.01 / 1.72 (first of three queries) |
| `POST .../answer` | 12.06 / 17.53 / 24.72 | 0.35 / 1.26 / 1.71 (the lookup only) |

**What this does not show:** many learners at once, a cold cache, a remote database, or network time beyond localhost. Each gateway call also includes one durable trace write and (for answers) one durable limiter check. No target was set before measuring.
