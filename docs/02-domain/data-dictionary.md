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

## research.backtest_run  (unique: config_hash; owner: Python service, migration 0007)
| Column | Type | Meaning |
|---|---|---|
| run_id | bigint identity PK | |
| config_hash | text (64 hex), unique | sha256 of canonical {spec, dataset_fingerprint, engine_version} |
| result_hash | text (64 hex) | sha256 of the rounded equity curve and trades |
| engine_version | text | bumped when results can change |
| spec | jsonb | the BacktestSpec (symbol, dates, fast, slow, fill_model, costs in bps, initial_cash) |
| dataset_fingerprint | text (64 hex) | sha256 of the exact bars used |
| symbol, first_date, last_date, bars_used | | window actually used |
| realisable | boolean | false for the `same_close` teaching mode |
| metrics, benchmark_metrics | jsonb | strategy and buy-and-hold metrics (conventions in backtest.md) |
| created_at | timestamptz | |

## research.backtest_trade  (PK: run_id, trade_no; ON DELETE CASCADE)
entry_date, exit_date, entry_price, exit_price (fill prices, slippage included; for an open trade the last close), shares (numeric 24,8), costs (commission plus slippage cost), pnl (net), closed (false for the position still open on the last bar).

## research.backtest_equity  (PK: run_id, trade_date; ON DELETE CASCADE)
equity (marked at the close), position (0 or 1).

## research.study  (owner: Python service, migration 0008)
study_id (identity PK), name, family (e.g. `sma_crossover`), symbol, created_at, holdout_used_at (NULL until the one-use holdout evaluation).

## research.trial  (FK study_id ON DELETE CASCADE)
trial_id (identity PK), study_id, phase (`train` | `test` | `holdout`, CHECK), params (jsonb, e.g. `{"fast": 5, "slow": 20}`), window_start, window_end, config_hash (nullable), total_return, sharpe (annualised, nullable when undefined), trades, created_at. Trials are append-only by convention: nothing deletes weak trials (ADR 0012).

## market.macro_observation  (PK: series_id, obs_date, source; owner: Python service, migration 0009)
series_id (`DGS3MO` = 3-month Treasury yield, percent per year; `VIXCLS` = VIX close, index points), obs_date (the date the value refers to), value NUMERIC(18,6) **NULL** when FRED had no value that day (`.` in the API), CHECK value IS NULL OR value > -1000, source (`fred`), ingestion_job_id (FK, job kind `macro`), loaded_at. Read with `read.get_macro` and `read.macro_asof(strict=True)`: the latest non-null value strictly before the date (never the same day, never later; `LookupError` before the first observation). This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis. VIXCLS: CBOE copyright caution (keep local).

## Tiingo rows (source = 'tiingo') in market.bar_daily and market.corporate_action
Same tables and keys as Alpaca (the `source` column is part of every primary key). Meaning of the fields: `trade_date` = the date part of Tiingo's `date` (already the trading date, no time-zone conversion); open/high/low/close = Tiingo's **raw** `open/high/low/close`; **volume = consolidated (all US venues)**, unlike Alpaca's IEX-only volume, so the two volumes are never compared or flagged; `trade_count` and `vwap` are NULL. The vendor's `adj*` fields are **not loaded**. Actions: `divCash > 0` -> `dividend` with `cash_amount`; `splitFactor != 1` -> `split` with `split_from = 1`, `split_to = splitFactor`. Vendor-coded spin-offs appear as small "splits" (for example PFE 2020-11-17 factor 1.054, MRK 2021-06-03 factor 1.048): Tiingo treats them as price-adjusting events; we store them as the vendor reports them. BRK.B is requested as `BRK-B` and stored as `BRK.B`. The symbol list, licence and rate limits are in Sources above; the policy is ADR 0013.

## research.episode  (owner: Python service, migration 0010; anonymous: no user column)
episode_id (text PK, 8 hex characters), seed (bigint; the same seed rebuilds the same episode), kind (`real` | `synthetic`, the ACTUAL kind), kind_requested (`real` | `synthetic` | `mixed`), symbol / source / start_date (real episodes only), synthetic_vol (generated episodes only), n_bars (60 to 500), initial_visible (>= 20, < n_bars), cursor_pos (the current day; between initial_visible and n_bars), status (`open` | `revealed`), created_at, revealed_at. CHECKs keep real rows complete and generated rows complete. Only `learning/episode.py` runs SQL on this table (a structural test enforces it). Identity (symbol, dates) leaves only through the reveal.

## research.prediction  (migration 0011; append-only)
prediction_id (identity PK), episode_id (FK, ON DELETE RESTRICT), made_at (the server's cursor when the guess was made), horizon (1, 5 or 10 bars), p_up NUMERIC(5,4) in [0.01, 0.99], created_at, outcome (0 or 1, NULL until resolved), status (`pending` | `resolved` | `void`), resolved_at_pos. UNIQUE (episode_id, made_at, horizon). **Trigger `research.prediction_guard`:** every DELETE raises; UPDATE is allowed only to move a pending row to `resolved` (needs outcome and resolution position) or `void` (no outcome), and never to change episode_id, made_at, horizon, p_up or created_at; a resolved or void row can never change.

## app.learner / app.learner_episode / app.glossary_term  (owner: NestJS gateway, `apps/api/migrations`, version table `app.pgmigrations`)
`app.learner`: learner_id (uuid PK), display_name (2 to 40 characters), display_name_key (lower-cased unique copy), password_hash (`scrypt$N$r$p$salt$hash`, never the password), created_at, last_login_at. `app.learner_episode`: (learner_id FK ON DELETE CASCADE, episode_id) primary key, episode_id UNIQUE (an episode has one owner; it is a plain text column because it refers to a Python-owned table in another schema). `app.glossary_term`: slug (PK), term, plain_definition, example, level, category (`learning` for words used on the screens, `general` for the rest), related (text[]), source. Seeded by `npm run seed:glossary` from `docs/02-domain/glossary.md` plus `apps/api/seed/learning-terms.json`; idempotent. Python never writes `app`.

## Environment variables added in Sprint 06 (names only)
`JWT_SECRET`, `INTERNAL_API_TOKEN` (random values generated on this machine), `GATEWAY_PORT` (3000), `PYTHON_API_URL` (http://127.0.0.1:8000), `CORS_ORIGINS` (the two local web origins), `LOGIN_LIMIT_PER_MINUTE` (5). The web app reads `VITE_API_BASE` (default http://127.0.0.1:3000).

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
| Tiingo End-of-Day (Starter, free) | https://www.tiingo.com/about/pricing , https://www.tiingo.com/documentation/end-of-day | **Second source (Sprint 05)**: raw daily OHLCV from 2005, splits and dividends | raw fields `open/high/low/close/volume`, `divCash`, `splitFactor` are loaded; `adj*` fields stay in the raw file only (used for the vendor check, never loaded) | consolidated US prices (volume is all venues) | Pricing page, retrieved 2026-11-08: the Starter plan lists "Unique Symbols per Month: 500", "Max Requests Per Hour: 50", "Max Requests Per Day: 1000" and License "Internal Use Only". Quote: "Internal use means you may only use the data for your own personal use" and "you may not display or share the data with another person or organization." The terms-of-service PDF/page was **not read**. | **no** (internal use only: `data/` and the database stay local; the Swagger service is loopback-only) | 50 / hour, 1,000 / day, 500 symbols / month |
| FRED API (St. Louis Fed) | https://fred.stlouisfed.org/docs/api/terms_of_use.html | **Macro (Sprint 05)**: `DGS3MO` (3-month Treasury yield, risk-free rate), `VIXCLS` (VIX close) | n/a (levels, `units=lin`) | n/a | Terms page, retrieved 2026-11-08: "Data series available through the FRED API, may be owned by third parties and subject to copyright restrictions." and, for use beyond personal use, "you must contact the data owner to obtain permission." Required notice: "This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." **VIXCLS**: the series notes name the CBOE as the copyright holder (series page not reachable by automated check: unverified), so VIX data stay local and private. | **no** for third-party series; DGS3MO treated the same (kept local) | not stated on the terms page (a few calls per run are used) |
| Kaggle "Huge Stock Market Dataset" | https://www.kaggle.com/datasets/borismarjanovic/price-volume-data-for-all-us-stocks-etfs | **Fallback** (manual download, not used) | adjusted (not raw) | n/a | terms unclear: the page text could not be read by the fetch tool, so no licence label was seen | unclear -> **no** | n/a |
| Stooq bulk | https://stooq.com/db/h/ | Not used | adjusted | n/a | terms unclear: no terms, copyright or redistribution statement was found on the page | unclear -> **no** | n/a |
| SEC EDGAR | https://www.sec.gov/about/webmaster-frequently-asked-questions | Out of scope (fundamentals, later) | n/a | n/a | "All Government-created content on sec.gov and EDGAR public filing content are free to access and reuse." | **yes** (public filings) | "Note that our current maximum access rate is 10 requests per second."; a declared User-Agent is required |
| yfinance | https://github.com/ranaroussi/yfinance | Not used (unofficial Yahoo client) | adjusted by default | n/a | "It's an open-source tool that uses Yahoo's publicly available APIs, and is intended for research and educational purposes." and "Remember - the Yahoo! finance API is intended for personal use only." | **no** (personal use only) | n/a |

**Observed vs documented history (Alpaca).** The docs list the Basic plan's historical timeframe as "Since 2016" and limit it to "the latest 15 minutes" delay for recent data, but the data actually returned for the 53-symbol universe starts on **2018-04-25** (individual symbols later, e.g. SPY 2018-11-01). **The effective data window used by this project is 2018-04-25 to 2025-12-31.** Whether the SIP feed would give a longer window was not tested; a later sprint may try it (decision: out of scope for Sprint 02).

**Primary-source decision.** Alpaca's free plan is used because it can return raw (unadjusted) bars with an explicit `adjustment=raw` parameter and has a documented corporate-actions endpoint, which lets the project store raw prices and corporate actions separately (ADR 0001). The free IEX feed covers only IEX-venue volume, which is acceptable for learning but must be remembered when interpreting volume. If Alpaca access fails, the Kaggle dataset is the fallback, but its prices are adjusted, so it cannot serve the raw-price invariant without conversion.

**Correction (Sprint 05).** The "2018-04-25" effective window above is superseded by the Sprint 04 audit: the *contiguous* window is **2020-07-27 to 2025-12-31** (about 5.4 years); see data-profile-v1.md. Sprint 05 adds Tiingo for a longer window; the policy is ADR 0013.

**Notice shown wherever FRED-derived numbers appear:** "This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."
