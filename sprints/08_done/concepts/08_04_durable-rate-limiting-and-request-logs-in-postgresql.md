# Durable rate limiting and request logs in PostgreSQL

**Sprint:** 08    **Used by tasks:** 08_04, 08_07, 08_08

## Why this matters for MarketLab
Sprint 07 limits Lab runs per minute, but the limiter lives in the gateway's memory: a restart gives every learner a fresh minute, and the same is true of the request trace on the "How does this work?" page. The owner's pending list names both. A small database-backed version makes limits and the trace survive restarts without adding Redis (which the project rules out without a measured reason).

## Plain-language explanation
- **Fixed or sliding window.** The current limiter counts hits in the last 60 seconds per learner (a sliding window kept in memory). A database version stores one row per accepted request (`learner_id`, `kind`, `at`) and counts rows newer than 60 seconds. Old rows are deleted by a periodic cleanup.
- **Token bucket (alternative).** A bucket holds up to N tokens and refills at a steady rate; each request takes a token. It allows short bursts and is easy to explain, but needs a stored token count and last-refill time per learner.
- **Atomic check and insert.** Two requests at the same instant must not both pass when only one slot is left. Do the count and insert in one statement or one transaction (for example with an advisory lock per learner, or `INSERT ... SELECT ... WHERE (count) < limit`).
- **Request trace.** One row per request with a route pattern, status and duration (no ids, bodies or tokens), kept for a short time (for example the last 200 per learner).

Example: limit 20 per minute. At 12:00:30 the learner has 20 rows newer than 12:00:00; the next call is refused with `Retry-After` equal to the seconds until the oldest row is 60 seconds old.

## Key terms
- sliding window: counts events in the last N seconds.
- token bucket: a refilling allowance that permits bursts up to its size.
- atomic: done as one indivisible step, so concurrent requests cannot both pass.
- `Retry-After`: the HTTP header telling a client how many seconds to wait.
- retention: how long rows are kept before cleanup.

## Common mistakes / pitfalls
- Check-then-insert in two statements (a race lets two requests through).
- Never deleting old rows (the table grows without bound).
- Counting refused requests as hits (a client in a loop never recovers).
- Logging ids, bodies or tokens in the trace table.
- An extra database round trip on every request without measuring it; record the cost.

## What to implement in this domain
- Tables `app.rate_event` and `app.request_log` (gateway-owned schema, migration with up and down).
- A limiter service using one atomic statement per check, with the same limits and `Retry-After` as Sprint 07; the login limiter moves to it too.
- A trace service reading and writing `app.request_log`, keeping the last 200 rows per learner.
- Tests: a restart (a new app instance on the same database) keeps the count; 30 concurrent requests with limit 20 let exactly 20 through; refused calls are not counted; cleanup removes old rows; the trace never stores ids or bodies.
- A benchmark of the added latency per request (p50 and p95), recorded without a target.

## How to check you understood
1. Why must the count and the insert be one step? (Otherwise two simultaneous requests can both see 19 and both pass.)
2. What happens to a counter kept only in memory when the server restarts? (It resets.)
3. How is `Retry-After` computed from the rows? (60 seconds minus the age of the oldest row in the window.)

## References
- [Wikipedia: Token bucket](https://en.wikipedia.org/wiki/Token_bucket): the algorithm and its burst behaviour (read 2026-11-09).
- [PostgreSQL: INSERT](https://www.postgresql.org/docs/current/sql-insert.html): INSERT ... SELECT and ON CONFLICT for atomic statements (read 2026-11-09).
- [PostgreSQL: Explicit locking (advisory locks)](https://www.postgresql.org/docs/current/explicit-locking.html): per-key locks for serialising checks (unverified: link not opened in this session).
- MarketLab concept 07_05 (protecting expensive endpoints) and `docs/03-benchmarks/benchmark-03-lab-run-latency.md`.
