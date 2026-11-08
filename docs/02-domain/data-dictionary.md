# MarketLab data dictionary (Sprint 01)

Schema `market` is owned by the Python service (`services/market-data`). Types below match migrations
`0001`-`0006` in `services/market-data/migrations/versions/` (status: **written; applied to a database only
after `poe migration-run` is verified**, see the sprint notes). Prices are **raw (unadjusted)**.
`trade_date` is the exchange-local trading **date**, not an instant. Glossary terms are in [glossary.md](glossary.md).

## market.instrument
| Column | Type | Unit | Null | Meaning | Example | Glossary |
|---|---|---|---|---|---|---|
| instrument_id | bigint identity PK | - | no | Stable internal key (never use the symbol as a foreign key) | 1 | - |
| symbol | text unique | - | no | Ticker as used by the provider | AAPL | stock |
| name | text | - | no | Company/fund name | Apple Inc. | stock |
| asset_type | text (`stock`/`etf`) | - | no | Instrument class | stock | stock, ETF |
| sector | text | - | yes | Sector label from universe_v1.csv | Technology | - |
| exchange_code | text | MIC | no | Calendar/exchange code, default XNYS | XNYS | exchange |
| currency | char(3) | ISO 4217 | no | Quote currency | USD | - |
| created_at | timestamptz | UTC | no | Row creation instant | 2026-11-07T10:00Z | - |

## market.bar_daily  (PK: instrument_id, trade_date, source)
| Column | Type | Unit | Null | Meaning | Example | Glossary |
|---|---|---|---|---|---|---|
| instrument_id | bigint FK | - | no | -> instrument | 1 | - |
| trade_date | date | exchange-local date | no | Session date (America/New_York); **not an instant** | 2020-08-31 | trade date |
| source | text | - | no | Provider that supplied the bar | alpaca | provenance |
| open, high, low, close | numeric(18,6) | USD per share | no | Raw prices of the session. CHECKs: all > 0, high >= max(open, close, low), low <= min(open, close, high) | 129.04 | OHLCV, raw price |
| volume | bigint | shares | no | Shares traded (>= 0). IEX feed volume is a subset of consolidated volume | 52000000 | volume |
| trade_count | bigint | trades | yes | Number of trades, if provided | 600000 | - |
| vwap | numeric(18,6) | USD | yes | Volume-weighted average price, if provided | 128.90 | - |
| ingestion_job_id | bigint FK | - | no | Job that last wrote the row | 12 | provenance |
| loaded_at | timestamptz | UTC | no | Last write instant | - | - |

## market.corporate_action  (unique: instrument_id, action_type, ex_date, source)
| Column | Type | Unit | Null | Meaning | Example | Glossary |
|---|---|---|---|---|---|---|
| corporate_action_id | bigint identity PK | - | no | Surrogate key | 1 | - |
| instrument_id | bigint FK | - | no | -> instrument | 1 | - |
| action_type | text (`split`/`dividend`) | - | no | Kind of action | split | split, dividend |
| ex_date | date | exchange-local date | no | First session trading under the new terms | 2020-08-31 | ex-dividend date |
| split_from / split_to | numeric(18,6) | shares | yes (splits only) | Old and new share counts: a 4-for-1 is from 1, to 4 (both > 0) | 1 / 4 | split |
| cash_amount | numeric(18,6) | USD per share | yes (dividends only) | Cash per share (>= 0) | 0.22 | dividend |
| source, ingestion_job_id, loaded_at | text, bigint FK, timestamptz | - | no | Provenance | alpaca | provenance |

## market.ingestion_job
| Column | Type | Null | Meaning |
|---|---|---|---|
| ingestion_job_id | bigint identity PK | no | Job id |
| kind | text (`bars`/`corporate_actions`) | no | What was loaded |
| source, file_name, file_sha256 | text | no | Provider, raw file, and the hash verified before loading |
| status | text (`running`/`succeeded`/`failed`) | no | Outcome; `failed` jobs have `error` set and no committed data |
| started_at, finished_at | timestamptz | no / yes | Timing |
| rows_read, rows_inserted, rows_updated, rows_unchanged, rows_rejected | bigint | no | Invariant: read = inserted + updated + unchanged + rejected |
| error | text | yes | Failure message |

## market.bar_quarantine
| Column | Type | Null | Meaning |
|---|---|---|---|
| quarantine_id | bigint identity PK | no | Id |
| ingestion_job_id | bigint FK | no | Job that rejected the row |
| symbol, trade_date | text, date | yes | Best-effort identity of the rejected record |
| reason | text | no | One of: unknown_symbol, null_value, non_positive_price, high_below_ohlc, low_above_ohlc, negative_volume, duplicate_key, invalid_split_ratio, invalid_dividend, unknown_action_type |
| raw_record | jsonb | no | The rejected record as received |
| quarantined_at | timestamptz | no | Instant |

## market.data_quality_result
| Column | Type | Null | Meaning |
|---|---|---|---|
| result_id | bigint identity PK | no | Id |
| run_id | text | no | One quality run; results of different runs coexist |
| rule | text | no | duplicate_key, ohlc_consistency, non_positive_price, negative_volume, zero_volume_day, large_move, stale_price, missing_session |
| severity | text (`error`/`warning`/`info`) | no | From the rule |
| instrument_id | bigint FK | no | -> instrument |
| trade_date | date | yes | Offending/missing session |
| detail | jsonb | no | Rule-specific, e.g. `{"return": -0.75, "explained_by_split": true}` or `{"classification": "provider_gap"}` |
| created_at | timestamptz | no | Instant |

## Adjustment modes (computed, never stored)

`market.bar_daily` stores **raw** prices only. `get_bars(..., adjustment=...)` and `GET /bars` compute adjusted series **as of the cursor** (`min(end, max_date)`); only corporate actions with `ex_date <= cursor` are used.

| Mode | Meaning |
|---|---|
| `raw` | As stored. Same columns as Sprint 01: trade_date, open, high, low, close, volume. |
| `split` | Prices of bars **before** each split ex-date are multiplied by `split_from / split_to` (4-for-1 -> 0.25); volume is multiplied by the inverse (shares rise), rounded to an integer. |
| `split_dividend` | As `split`, plus each cash dividend with `ex_date <=` cursor multiplies earlier bars by `1 - dividend / raw close of the last session before the ex-date`. |

Adjusted results add columns `factor` (cumulative price factor), `adjustment` (mode) and `as_of` (cursor date). The bar on the ex-date is never adjusted by that action. Migration `0007` is **not** added (see ADR 0008 and the benchmark report for the index decision).

## Sources

Terms were read on **2026-11-08** from the pages listed (quotes are verbatim from the fetched page text; where a page did not state terms, that is written as "terms unclear" with the reason).

| Source | URL | Used for | Adjustment | Feed | License / terms (quoted) | Redistribution | Rate limits |
|---|---|---|---|---|---|---|---|
| Alpaca Market Data (free plan) | https://docs.alpaca.markets/docs/about-market-data-api | **Primary**: daily bars, corporate actions | `adjustment=raw` requested | IEX ("for equities only the IEX exchange") | The disclosures page says only: "Market prices, data and other information available through Alpaca are not warranted as to completeness or accuracy". The use/redistribution terms are in the linked NASDAQ OMX Global Subscriber Agreement and NYSE Market Data Display Services Agreement PDFs, which were **not read**: terms unclear for redistribution. The docs page contains no statement permitting or forbidding redistribution. | unclear -> treated as **no** (`data/` is git-ignored) | "200 / min" historical calls (Basic) |
| Kaggle "Huge Stock Market Dataset" | https://www.kaggle.com/datasets/borismarjanovic/price-volume-data-for-all-us-stocks-etfs | **Fallback** (manual download, not used) | adjusted (not raw) | n/a | terms unclear: the page text could not be read by the fetch tool, so no licence label was seen | unclear -> **no** | n/a |
| Stooq bulk | https://stooq.com/db/h/ | Not used | adjusted | n/a | terms unclear: no terms, copyright or redistribution statement was found on the page | unclear -> **no** | n/a |
| SEC EDGAR | https://www.sec.gov/about/webmaster-frequently-asked-questions | Out of scope (fundamentals, later) | n/a | n/a | "All Government-created content on sec.gov and EDGAR public filing content are free to access and reuse." | **yes** (public filings) | "Note that our current maximum access rate is 10 requests per second."; a declared User-Agent is required |
| yfinance | https://github.com/ranaroussi/yfinance | Not used (unofficial Yahoo client) | adjusted by default | n/a | "It's an open-source tool that uses Yahoo's publicly available APIs, and is intended for research and educational purposes." and "Remember - the Yahoo! finance API is intended for personal use only." | **no** (personal use only) | n/a |

**Observed vs documented history (Alpaca).** The docs list the Basic plan's historical timeframe as "Since 2016" and limit it to "the latest 15 minutes" delay for recent data, but the data actually returned for the 53-symbol universe starts on **2018-04-25** (individual symbols later, e.g. SPY 2018-11-01). **The effective data window used by this project is 2018-04-25 to 2025-12-31.** Whether the SIP feed would give a longer window was not tested; a later sprint may try it (decision: out of scope for Sprint 02).

**Primary-source decision.** Alpaca's free plan is used because it can return raw (unadjusted) bars with an explicit `adjustment=raw` parameter and has a documented corporate-actions endpoint, which lets the project store raw prices and corporate actions separately (ADR 0001). The free IEX feed covers only IEX-venue volume, which is acceptable for learning but must be remembered when interpreting volume. If Alpaca access fails, the Kaggle dataset is the fallback, but its prices are adjusted, so it cannot serve the raw-price invariant without conversion.
