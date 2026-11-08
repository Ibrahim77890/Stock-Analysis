# Risk-free rate, excess returns and macro series "as of"

**Sprint:** 05    **Used by tasks:** 05_05, 05_07, 05_08

## Why this matters for MarketLab
The Sharpe ratio is defined on **excess** return over a risk-free rate; Sprint 03 and 04 set that rate to 0, which flatters nothing but misstates the number, and in 2022-2025 short-term rates were far from 0. A macro series also introduces a new way to leak the future: using a value before it was published. The VIX adds a market-wide regime label that does not depend on the asset's own returns.

## Plain-language explanation
**Risk-free rate.** FRED series `DGS3MO` is the market yield on 3-month U.S. Treasury securities (constant maturity), quoted as a percent per year. Daily risk-free return used here: `rf_t = (y / 100) / 252`, where `y` is the last observation **known before day t's return** (the previous trading day's value). Excess return `r_t - rf_t`; excess Sharpe = `mean(excess) / std(excess) x sqrt(252)`.

Example: `y = 4.80` -> `rf = 0.048 / 252 = 0.0001905` per day. A day with strategy return 0.0005 has excess 0.000310.

**As-of rule.** `macro_asof(series, d)` returns the latest observation with `obs_date < d` for returns of day `d` (or `<= d` for end-of-day labels); never a later one. FRED encodes missing values as `.`; store them as NULL (not 0) and let the as-of lookup skip back to the last non-null value. Before the first observation the lookup raises an error rather than assuming 0.

**VIX.** `VIXCLS` is the CBOE Volatility Index close, an annualised 30-day implied volatility of the S&P 500 in index points. A regime label by fixed buckets (documented convention, chosen in advance): `low` below 15, `medium` 15 to 25, `high` 25 or more, using the previous trading day's close. (Fixed thresholds avoid the hindsight of full-sample terciles.)

**Terms.** FRED's terms say third-party series may be copyrighted and use beyond personal use needs the owner's permission, and that the notice "This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis" must be shown. The VIX series notes name the CBOE as copyright holder: keep the data local and private.

## Key terms
- risk-free rate: return of a safe asset; here the 3-month Treasury yield.
- excess return: return minus the risk-free return for the same period.
- as-of lookup: the latest value known at a given time.
- publication lag: delay between the date a value refers to and when it is available.
- regime bucket: a labelled range of an indicator such as the VIX.

## Common mistakes / pitfalls
- Using a percent value as a decimal (4.8 vs 0.048).
- Using the same day's yield for the same day's return when it might not have been known.
- Treating `.` as zero.
- Annualising with 365 while the project uses 252 trading days.
- Mixing "level" and "change" units (FRED `units` parameter must stay `lin`).

## What to implement in this domain
- Table for macro observations keyed by series, date and source; idempotent load; NULL for missing.
- `read.get_macro` and an as-of lookup with the rules above; tests that later observations are never returned.
- Excess-return Sharpe and the VIX bucket labels, both using the previous day's value.
- Display of the FRED attribution notice in the docs that show FRED-derived numbers.

## How to check you understood
1. `y = 5.04`. Daily rf? (0.0504 / 252 = 0.0002.)
2. FRED returns `.` for a holiday. What is stored and what does the as-of lookup return for that date? (NULL; the previous non-null observation.)
3. Why use the previous day's value? (The current day's value may not be known at the time the return is earned.)

## References
- [FRED API: series/observations](https://fred.stlouisfed.org/docs/api/fred/series_observations.html): endpoint and parameters (read 2026-11-08).
- [FRED API terms of use](https://fred.stlouisfed.org/docs/api/terms_of_use.html): attribution and third-party rights (read 2026-11-08).
- [FRED series DGS3MO](https://fred.stlouisfed.org/series/DGS3MO) (unverified: not reachable by an automated check): description and units.
- [FRED series VIXCLS](https://fred.stlouisfed.org/series/VIXCLS) (unverified): description and copyright note.
- [Wikipedia: Risk-free interest rate](https://en.wikipedia.org/wiki/Risk-free_interest_rate) and [VIX](https://en.wikipedia.org/wiki/VIX): background.
- [Sharpe, The Sharpe Ratio (1994)](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm): excess-return definition.
