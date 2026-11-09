# ADR 0013: Second price source, macro data and key handling

Status: accepted (Sprint 05). Written before any Tiingo or FRED data were downloaded.

## Context
All data so far come from one free IEX feed with a 5.4-year contiguous window (ADR 0012). Blueprint 25.6 asks for a cross-check against a second source, and 25.4 for FRED macro series. Public availability is not permission to redistribute (data-dictionary Sources).

## Decision
- **Rows are keyed by `source`** (`alpaca`, `tiingo`; already part of every primary key). A read names its source; **a series is read from one source only. Sources are never spliced or averaged.**
- **Primary source per use:** Alpaca (IEX-venue) for studies that need to match the earlier sprints; Tiingo for long-history price studies. Volume from the two sources is not comparable (IEX only vs consolidated) and is never reconciled.
- **Raw only.** Tiingo's `adj*` fields are never loaded into the database. They remain in the local raw file and are used for one external check (our as-of dividend adjustment vs the vendor's). Adjustment stays computed as of a date from raw prices and actions (ADR 0001, 0009).
- **Local only.** Raw files, the database and reports stay on this machine (`data/` is git-ignored). Tiingo's free plan is "Internal Use Only"; FRED third-party series (VIXCLS, CBOE) may be copyrighted. The Swagger service stays loopback-only.
- **Attribution.** Wherever FRED-derived numbers are shown: "This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis."
- **Keys** live in the git-ignored `.env` (`TIINGO_API_KEY`, `FRED_API_KEY`). Code reads them through `config.tiingo_key()` / `config.fred_key()`, which name the variable and never the value in errors. Tiingo sends its key in an `Authorization` header; FRED requires it as a query parameter, so request URLs are never logged or stored, and all exception text passes through `config.redact`. `market-data check-keys [--ping]` reports presence and length only.
- **Macro as-of rule.** A macro value is usable for the return of day *d* only if its observation date is earlier than *d* (`macro_asof(..., strict=True)`). FRED's `.` is stored as NULL, never 0, and the lookup skips back to the last non-null value.
- **Price basis.** The backtest gains `price_basis` (`split` default, `split_dividend`) and `source` (`alpaca` default). They enter the config hash only when not the defaults, so Sprint 03 hashes do not change.
- **Rate limits.** The Tiingo downloader makes one request per symbol, at most 45 per run (limit 50 per hour), stops on HTTP 429 with exit code 3, and is resumable by manifest.

## Alternatives
Averaging the two sources (hides disagreement); loading vendor-adjusted prices (breaks the "adjust as of a date" causality argument); storing keys in code or URLs (leak risk); ALFRED vintage data for macro revisions (deferred; daily yields and VIX are not revised).

## Consequences
Two parallel price series per symbol; reports must say which one they used. The long window comes with a licence constraint that rules out public dashboards of the raw data.

## Appendix A: reconciliation tolerances (fixed before any comparison was run)
- A **close mismatch** is an absolute relative difference of **more than 1.0%** (100 bps) between the two sources on the same date.
- A **notice** is a difference of **more than 0.25%** (25 bps) up to 1.0%.
- **Volume ratios** are reported and **never flagged**.
- Corporate actions **agree** if the ex-dates are equal and the split ratio (to / from) or cash amount is within **0.5%** relative.
- Dates present in only one source are counted and listed, not treated as errors.
- Vendor adjusted-close check: ratio `ours_split_dividend_as_of_end / vendor adjClose` should be near-constant; tolerance **0.5%** for the spread (p5 to p95) per symbol, stated before running.

(The results of these checks are appended below by task 05_04 and 05_06.)

## Appendix B: reconciliation result (task 05_04, run 2026-11-08, tolerances of Appendix A unchanged)
Window 2020-07-27 to 2025-12-31 (the contiguous Alpaca window), 53 symbols, raw prices.
- **Dates:** 72,312 Alpaca dates, 72,398 Tiingo dates; matched 72,312; only in Alpaca 0; only in Tiingo 86 (2021-04-19: 29 symbols, 2021-10-25: 28, 2022-03-08: 28, 2021-06-11: 1; the three whole-market dates are missing from the Alpaca series).
- **Closes:** median absolute difference 2.0 bps (median over symbols), median per-symbol p99 13.7 bps; 99.77% of matched dates differ by 25 bps or less; **121 notices** (> 0.25%) and **43 mismatches** (> 1.0%, 33 symbols, largest 5.2% for TSLA on 2020-12-18). Mismatches cluster on market-wide dates: 2024-12-23 (18 symbols), 2022-01-24 (16), 2024-06-03 (4), 2020-12-18 (2). In 41 of the 43 the Alpaca close is the lower one. Working hypothesis, not verified against exchange data: the IEX "close" is the last IEX-venue print, which can precede a late-day move or the closing auction (TSLA joined the S&P 500 at the 2020-12-18 close), whereas Tiingo carries the consolidated close.
- **Volume:** Alpaca/Tiingo volume ratio has a median of 2.7% (range of symbol medians 1.0% to 4.4%): IEX is a small share of consolidated volume. Never flagged, as decided.
- **Corporate actions (2020-07-27 onwards):** 1,035 agree, 3 disagree, 0 only in Alpaca, 14 only in Tiingo. The 3 disagreements are Alpaca duplicates summed by the Sprint 01 merge rule (QQQ 2022-09-19: 1.03712 vs 0.51856; LIN 2023-03-13: 2.55 vs 1.275; GE 2021-06-25: 0.02 vs 0.01); see `sprints/05_current/pending/05_P01`. The 14 only in Tiingo: 9 December-2025 dividends (AMT, CRM, DIA, DIS, GE, MRK, NKE, SPY, WMT; ex-dates 2025-12-01 to 2025-12-29, absent from the Alpaca file) and 5 events that Tiingo codes as splits and Alpaca does not list (PFE 2020-11-17, MRK 2021-06-03, T 2022-04-11, GE 2023-01-04 and 2024-04-02; by my knowledge these are spin-offs, not confirmed in the data).
- **Vendor adjusted close (05_06):** spread (p95/p5 - 1) of ours/vendor over 21 years between 0.015% and 0.295% for nine symbols, tolerance 0.5% met.
- **Reading:** the two sources agree on prices to a few basis points on typical days; the disagreements are explainable by what each feed is (one venue vs consolidated), and the largest ones are concentrated on a few market-wide dates. Agreement is not proof of correctness: both could share an error.
