# Vendor corporate actions: raw prices, `splitFactor`, `divCash`

**Sprint:** 05    **Used by tasks:** 05_02, 05_03, 05_06

## Why this matters for MarketLab
ADR 0001 says store raw prices plus a separate corporate-actions table and compute adjustments as of a date. Tiingo returns both raw and adjusted fields in the same record. If the adjusted fields were loaded by mistake, they would use dividends and splits from the future and quietly leak it into every backtest.

## Plain-language explanation
Tiingo's daily endpoint returns, per date: `open, high, low, close, volume` (raw, as traded), `adjOpen ... adjClose, adjVolume` (adjusted by the vendor, following CRSP's method for splits and dividends, as of the latest date), `divCash` (the dividend whose ex-date is that day, else 0) and `splitFactor` (1.0 unless a split or distribution happens that day).

**What to load.** Only the raw fields into `market.bar_daily` (`source = 'tiingo'`), and corporate actions into `market.corporate_action`: a row for each day with `divCash > 0` (cash dividend) and each day with `splitFactor != 1` (a split with `split_to = splitFactor` and `split_from = 1`; for example 4.0 means 4-for-1, 0.125 a 1-for-8 reverse split). The vendor's adjusted columns are used only as an **external check** of our own as-of adjustment (task 05_06).

Example (illustrative numbers, not from a download): AAPL on 2020-08-31 shows raw close 129.04 and `splitFactor` 4.0; the previous raw close was 499.23. Our factor for earlier bars is 1/4, giving an adjusted previous close of 124.81, a +3.4% move.

**Date semantics.** Tiingo's `date` is the trading date at midnight UTC (e.g. `2020-08-31T00:00:00.000Z`); take the date part without converting time zones. (Alpaca timestamps are the opposite: instants that must be converted to New York time.)

## Key terms
- raw price: unadjusted traded price.
- adjusted price (vendor): rescaled with the full-sample splits and dividends known today.
- `splitFactor`: multiplier for shares (4.0 = 4-for-1).
- `divCash`: cash dividend per share on the ex-date.
- CRSP: the Center for Research in Security Prices, whose adjustment method Tiingo says it follows.

## Common mistakes / pitfalls
- Loading `adjClose` into the close column.
- Treating `splitFactor` 1.0 as a split row, or a missing value as 0.
- Converting Tiingo dates through a time zone and shifting them by a day.
- Mixing sources inside one series after loading.
- Assuming raw volume from Tiingo is comparable with Alpaca IEX volume.

## What to implement in this domain
- `normalise_tiingo(records)` -> bars and actions frames in the existing schema; unit tests with the AAPL split record and a dividend record.
- Validation reusing `load.validate_bars` and `load.validate_actions`; invalid rows go to quarantine with a reason.
- Several `divCash` rows on one ex-date cannot occur in one daily record, but the existing same-day merge rule stays in place.
- A manifest per file (provider `tiingo`, endpoint, parameters, retrieved_at, row_count, sha256, licence note "internal use only").

## How to check you understood
1. `splitFactor` is 0.125 on some date. What happened? (A 1-for-8 reverse split.)
2. Why not load `adjClose`? (It uses dividends and splits after the bar's date, which leaks the future into an as-of replay.)
3. A record's date is `2021-03-05T00:00:00.000Z`. Which trade date do we store? (2021-03-05.)

## References
- [Tiingo: end-of-day prices documentation](https://www.tiingo.com/documentation/end-of-day): field definitions (read 2026-11-08).
- [Wikipedia: Center for Research in Security Prices](https://en.wikipedia.org/wiki/Center_for_Research_in_Security_Prices): background on the adjustment convention.
- [Investor.gov: dividend glossary entry](https://www.investor.gov/introduction-investing/investing-basics/glossary/dividend): definition.
- [Wikipedia: Ex-dividend date](https://en.wikipedia.org/wiki/Ex-dividend_date): why the price drops on the ex-date.
