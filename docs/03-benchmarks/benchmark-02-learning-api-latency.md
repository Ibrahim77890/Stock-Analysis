# Benchmark 02: learning API latency (generated 2026-11-09T07:26 UTC)

Produced by `apps/api/scripts/latency.ts` (`npm run latency` in `apps/api`). Informational: these are measurements on one machine, not targets and not promises.

**What was measured.** 200 sequential calls per row, loopback, after one warm-up call, wall-clock time from sending the request to reading the whole body, in milliseconds. "Through the gateway" is browser-style access (login token, ownership check, validation, whitelisting, trace) to the Python service; "directly to Python" sends the internal token straight to the service. Real Tiingo episodes (250 or 500 bars) and one made-up episode with 30 answered guesses for the score. Every episode created by this run is anonymous and stays in the real database (8 episodes, 1 learner account named `latency-mw8xqgit`).

**Reading the table.** The two paths are measured interleaved (one gateway call, one direct call, repeated), each on its own episode, so drift affects both equally. Differences of a few milliseconds are within the noise of this machine (the p95 and p99 columns show occasional spikes of about 100 ms that appear on both paths, consistent with other programs and the operating system, not with either service). The gateway adds an ownership query, validation, a whitelist and a trace entry; this run does not resolve its cost more finely than that.

**Machine.** Windows_NT 10.0.26300, 8 x 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz, 7.7 GB RAM, Node v20.19.0, Python 3.14.10, PostgreSQL local service. Other programs were running (including the web dev server), so treat differences of a few milliseconds as noise.

| Call | Path | Calls | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
| GET bars (real, 250 bars) | through the gateway | 200 | 97.8 | 204.2 | 210.5 |
| GET bars (real, 250 bars) | directly to Python | 200 | 93.3 | 196.0 | 210.1 |
| POST advance (1 day, real episode) | through the gateway | 200 | 59.0 | 165.3 | 169.5 |
| POST advance (1 day, real episode) | directly to Python | 200 | 54.2 | 161.6 | 166.7 |
| POST predictions (new guess) | through the gateway | 200 | 51.1 | 163.3 | 171.3 |
| POST predictions (new guess) | directly to Python | 200 | 46.9 | 159.3 | 166.1 |
| GET score (30 guesses, 5,000 shuffles) | through the gateway | 200 | 51.2 | 162.8 | 166.4 |
| GET score (30 guesses, 5,000 shuffles) | directly to Python | 200 | 48.0 | 158.1 | 165.3 |

**Gateway overhead (gateway minus direct).**

| Call | p50 ms | p95 ms |
|---|---|---|
| GET bars (real, 250 bars) | 4.5 | 8.2 |
| POST advance (1 day, real episode) | 4.7 | 3.6 |
| POST predictions (new guess) | 4.2 | 4.1 |
| GET score (30 guesses, 5,000 shuffles) | 3.2 | 4.8 |
