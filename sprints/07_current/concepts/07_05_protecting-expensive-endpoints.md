# Protecting expensive endpoints: caps, limits, timeouts and safe errors

**Sprint:** 07    **Used by tasks:** 07_02, 07_03, 07_04, 07_08, 07_09

## Why this matters for MarketLab
A lab run computes a backtest, a cost sweep and a hundred shuffled charts. One careless request (huge averages, 10,000 shuffles, a loop that clicks Run 500 times) can keep the Python service busy for minutes and freeze everyone else. OWASP lists this as a top API risk: **unrestricted resource consumption**. The gateway and the Python service must each set limits, because either can be called wrongly.

## Plain-language explanation
Limits come in layers, cheapest first:
1. **Input caps** (reject early): averages between 2 and 300 days, the short one shorter than the long one, costs 0 to 50 bps, at most 20 studies per learner and 200 runs per study. Out-of-range input is a `422`, before any work.
2. **Rate limit** (per learner, per minute): at most, say, 20 runs a minute; beyond that `429 Too Many Requests` with a plain message and, ideally, a `Retry-After` header.
3. **Work caps inside the service**: at most 200 shuffled paths, a maximum number of bars, a time budget; the service refuses work above its own caps even if the gateway forgot.
4. **Timeouts**: the gateway stops waiting after a fixed time (30 s) and answers `504` with a safe message; it must not leave the browser spinning.
5. **Safe errors**: messages name the problem for the learner ("Choose a long average between 5 and 300 days") and never contain stack traces, URLs, tokens or vault dates.

**Idempotency** matters too: a double click on "Run" should not create two identical trials. A run is keyed by `(study, fast, slow, cost)`: a repeat returns the stored result and does not count as a new try. (HTTP `POST` is not idempotent by itself; the application makes it so.)

## Key terms
- resource consumption: CPU time, memory and requests an endpoint can use.
- cap: a hard maximum on an input or on work.
- rate limit: a maximum number of requests per time window (HTTP 429).
- timeout: how long to wait before giving up (HTTP 504 from a gateway).
- idempotent request: repeating it has the same effect as sending it once.
- retry-after: a header saying when to try again.

## Common mistakes / pitfalls
- Limits only in the browser (any script can skip them).
- Limits only in one layer (a caller that bypasses the gateway skips them).
- A rate limit keyed only by network address (everyone on one machine shares it) or only by user (one user can still flood).
- Error text that reveals internals.
- Counting an idempotent repeat as a new try (it would inflate the "ideas tried" number).

## What to implement in this domain
- Caps in the Python lab function (authoritative) and mirrored DTO limits in the gateway (early 422).
- A per-learner limiter for lab runs in the gateway (429), plus per-study caps stored in the database.
- A measured worst-case run time for the largest allowed input (recorded, not promised).
- Tests for each cap, the 429, the 504 and the idempotent repeat.

## How to check you understood
1. Why cap inside Python if the gateway already validates? (Python can be called directly or by a future caller; each layer protects itself.)
2. What status for "too many runs this minute"? (429, ideally with Retry-After.)
3. What does an idempotent run do on a double click? (Returns the first result; the try count stays the same.)

## References
- [OWASP API4:2023 Unrestricted Resource Consumption](https://api-security.owasp.org/editions/2023/en/0xa4-unrestricted-resource-consumption): the risk and its mitigations (read 2026-11-09; the older owasp.org address redirects here).
- [MDN: 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429): rate-limit status and `Retry-After` (read 2026-11-09).
- [MDN: Idempotent](https://developer.mozilla.org/en-US/docs/Glossary/Idempotent): definition; `POST` is not guaranteed idempotent (read 2026-11-09).
- MarketLab ADR 0014 (gateway rules) and Sprint 05 note on the Tiingo free-tier limit (another example of a rate limit).
