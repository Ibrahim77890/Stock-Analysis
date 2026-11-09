# Sprint 05: A second price source, total-return prices and a risk-free rate

## Goals
- Add a second, longer daily-price source (Tiingo free plan, 2005 onward) next to Alpaca IEX, loaded raw into the same tables with `source = 'tiingo'`, and reconcile the two with tolerances fixed in advance.
- Make backtests honest about dividends: a `split_dividend` price basis that is proven causal, with existing hashes unchanged, and an external check against the vendor's adjusted close.
- Add FRED macro data (3-month Treasury yield for the risk-free rate, VIX) with an as-of read rule, excess-return Sharpe and fixed VIX regime buckets.
- Rerun Sprint 04's validation on about twenty years of data and say plainly what changes and what does not.
- Keep it testable by hand: every new function has a Swagger endpoint; keys are checked without ever being printed.

## Why this sprint now
Sprint 04 is done and verified (see `sprints/current_status.md`). Its audit found that the usable data window is only 2020-07-27 to 2025-12-31 (about 5.4 years), so validation blocks held 1 to 5 trades and every conclusion was noisy; Sharpe used a zero risk-free rate; dividends were ignored; and nothing cross-checked the one free IEX source. Blueprint 25.6 asks for Alpaca cross-checked with Tiingo, and 25.4 for FRED. Data foundation comes before more strategy work (agent rule: prefer the earlier layer).

**Needs from the owner (free):** `TIINGO_API_KEY` and `FRED_API_KEY` in `.env` (placeholders and instructions are in `.env.example`). Code and tests use mocks and fake keys, so they can be written without keys; the live downloads (05_02, 05_05) need them.

## Learning concepts
1. [Multi-source data and reconciliation](concepts/05_01_multi-source-data-and-reconciliation.md)
2. [Vendor corporate actions: raw vs adjusted fields](concepts/05_02_vendor-corporate-actions-and-raw-vs-adjusted.md)
3. [Price return vs total return, dividend adjustment as of a date](concepts/05_03_total-return-and-dividend-adjustment.md)
4. [Rate-limited APIs, resumable downloads and secrets](concepts/05_04_rate-limited-apis-and-resumable-downloads.md)
5. [Risk-free rate, excess returns and macro series as of a date](concepts/05_05_risk-free-rate-and-macro-series-as-of.md)
6. [Long history: what it changes and what it does not](concepts/05_06_long-history-and-what-it-changes.md)

## Tasks (in order)
| ID | Title | Depends on |
|---|---|---|
| [05_01](tasks/05_01_task.md) | Source terms, multi-source policy (ADR 0013) and key handling | none |
| [05_02](tasks/05_02_task.md) | Resumable Tiingo downloader | 05_01 |
| [05_03](tasks/05_03_task.md) | Load Tiingo bars and corporate actions as a second source | 05_02 |
| [05_04](tasks/05_04_task.md) | Cross-source reconciliation (Alpaca IEX vs Tiingo) | 05_03 |
| [05_05](tasks/05_05_task.md) | FRED macro series, loaded and read as of a date | 05_01 |
| [05_06](tasks/05_06_task.md) | Total-return price basis in the backtest, checked against the vendor | 05_03 |
| [05_07](tasks/05_07_task.md) | Excess-return Sharpe and VIX regimes | 05_05, 05_06 |
| [05_08](tasks/05_08_task.md) | Expose the new functions in Swagger and add `source` / `price_basis` / `risk_free` options | 05_03 to 05_07 |
| [05_09](tasks/05_09_task.md) | Long-window revalidation, documentation and sprint wrap-up | all |

## Out of scope / deferred
- Fundamentals (SEC companyfacts), Kenneth French factors and alpha/beta regressions, delisted names and a survivorship demonstration, intraday bars.
- Interest on idle cash inside the engine; reinvestment timing; taxes.
- More strategies, portfolios, shorting, stops, anchored walk-forward, demeaned controls, effective-N estimation.
- Frontend charts, NestJS, authentication, lessons, prediction scoring, paper trading.
- Cold-cache benchmark (administrator restart of PostgreSQL), API latency measurement, Alpaca agreement PDFs.
- Any new infrastructure (no queue, no new store).

## Definition of done
All acceptance criteria in 05_01 to 05_09 pass, or the unfinished item is in `pending/` with a reason; the suite passes with `TEST_DATABASE_URL`; the key-redaction, idempotency, as-of and truncation tests (and their negative tests) pass; Sprint 03 saved-run hashes are unchanged; the OpenAPI contract is refreshed; ADR 0013, the reconciliation result and the generated long-window page exist and reproduce on a fresh database from the local raw files.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 05 and plan the next one."
