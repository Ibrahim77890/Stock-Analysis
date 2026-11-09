# Rate-limited APIs, resumable downloads and secrets

**Sprint:** 05    **Used by tasks:** 05_01, 05_02, 05_05, 05_08

## Why this matters for MarketLab
Tiingo's free plan allows 50 requests per hour, 1,000 per day and 500 unique symbols per month (pricing page, read 2026-11-08). The universe has 53 symbols, so a download needs at least two hours of waiting if done carelessly. A downloader that cannot stop and resume wastes the quota, and one that prints its key into a log leaks a credential.

## Plain-language explanation
**Rate limit:** a cap on requests per time window. A client must count its own requests, stop before the cap, and treat HTTP 429 ("too many requests") as a signal to stop, not to retry in a tight loop.

**Resumable download:** each symbol is one request and one file with a manifest. A rerun skips symbols whose manifest exists and matches (Sprint 01 does this for Alpaca), so the job can be run again after an hour and continues where it stopped. A `--max-requests` option (default 45 for Tiingo, leaving headroom below 50) makes one run stay under the hourly cap.

Example: 53 symbols, 45 per run: run 1 downloads 45 files; one hour later run 2 downloads the remaining 8 and skips the 45.

**Secrets.** The key lives only in the git-ignored `.env`. Pass it in an HTTP header or query parameter as the vendor requires, but never write it to logs, manifests, exceptions, reports or API responses. Manifest `parameters` store a redacted form. Tests check that a fake key string never appears in any output.

## Key terms
- rate limit / quota: the allowed requests per window.
- HTTP 429: the server refuses because the quota is used up.
- backoff: waiting longer after each failure.
- idempotent download: running again does not duplicate or overwrite files.
- redaction: replacing a secret with a placeholder in anything that is stored or printed.

## Common mistakes / pitfalls
- Retrying a 429 immediately (wastes quota and may extend a block).
- Counting only successful requests toward the hourly cap.
- Overwriting a good file when a rerun fails.
- Putting the key in a URL that is then logged or stored in a manifest.
- Forgetting the monthly unique-symbol cap when experimenting with other symbols (500 per month).

## What to implement in this domain
- A downloader with `max_requests`, a request counter, 429 handling that stops cleanly with a message "quota reached; rerun later", and the same no-overwrite rule as Sprint 01.
- Manifests storing `parameters` without the token.
- A test with a mocked HTTP layer proving: the cap is honoured, a 429 stops the run, a rerun skips finished symbols, and the fake key never appears in files, logs or exceptions (negative test).
- Where the project owner keeps it: next to `download.py`; raw files under `data/raw/tiingo/` (git-ignored).

## How to check you understood
1. 53 symbols, cap 45 per run: how many runs, and what does the second do? (Two; it downloads 8 and skips 45.)
2. The server answers 429 on request 31. What does the client do? (Stops, saves what it has, reports it, and does not retry now.)
3. Where may the token appear? (Only in the in-memory request; never in a stored or printed value.)

## References
- [Tiingo pricing page](https://www.tiingo.com/about/pricing): quota figures (read 2026-11-08).
- [Tiingo documentation overview](https://www.tiingo.com/documentation/general/overview): authentication and general behaviour.
- [MDN: 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/429) (unverified): meaning of the status and the `Retry-After` header.
- [httpx documentation](https://www.python-httpx.org/) (unverified): the client library already used by the project.
