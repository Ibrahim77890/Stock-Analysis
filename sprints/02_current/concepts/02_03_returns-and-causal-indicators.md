# Returns and causal indicators

**Sprint:** 02    **Used by tasks:** 02_05

## Why this matters for MarketLab
Every chart overlay, signal and backtest in later sprints is built from returns and indicators. If an indicator quietly uses future bars (a centred window, a normalisation over the whole series), every result built on it is leaked and looks better than reality. This concept fixes the definitions and the test that proves an indicator is causal.

## Plain-language explanation
- **Simple return:** `r_t = P_t / P_(t-1) - 1`. Close 100 then 102 -> +2.0%.
- **Log return:** `ln(P_t / P_(t-1))`; adds up over time (ln 1.02 = 0.0198).
- **SMA(n):** the average of the last n closes **including today**. SMA(3) of 10, 11, 12 on day 3 = 11. It is undefined (null) for days 1 and 2; never fill it from the future.
- **EMA(n):** `EMA_t = a * P_t + (1 - a) * EMA_(t-1)` with `a = 2 / (n + 1)`; seed from the first values, document how.
- **Rolling volatility(n):** standard deviation of the last n returns (sample, `n-1`), usually annualised by `sqrt(252)` for daily data.
- **Causal** means the value at time *t* depends only on data up to *t*. The test: compute the indicator on the full series, compute it again on the series cut at *t*, and compare the value at *t*. They must be equal.

Warning example: `rolling(center=True)` averages the bars before **and after** each date, so every value uses the future. It is a look-ahead bug even though the code runs without errors.

## Key terms
- Window / lookback, warm-up period (the first n-1 values are null)
- Causal vs centred window
- Truncation invariant
- Annualisation factor (252 trading days)
- Adjusted vs raw input (indicators on raw prices jump at splits; use the as-of adjusted series from 02_03)

## Common mistakes / pitfalls
- `center=True`, or using `.shift(-1)`, or any global statistic (z-score over the full series) as a feature.
- Computing indicators on raw prices across a split (a fake -75% return).
- Filling the warm-up nulls with backward fill.
- Mixing population and sample standard deviation silently.
- Forgetting that the first return of a series is null, not 0.

## What to implement in this domain
- Pure functions on a Polars frame sorted by date, per instrument: `simple_return`, `log_return`, `sma`, `ema`, `rolling_volatility`.
- A single indicator contract: input adjusted bars as-of the cursor, output same-length series with leading nulls.
- Golden tests with hand-computed values (small fixed series) and a cross-check against Polars rolling functions.
- A property test for the truncation invariant for every indicator, over random cut points on real data.
- A negative test: a deliberately leaky indicator (`center=True`) must be *detected* as non-causal by the same test.

## How to check you understood
1. SMA(3) of closes 10, 11, 12, 13 on day 4? (12.)
2. Why must the first return be null? (There is no previous close.)
3. What does the truncation test do to `rolling_mean(center=True)`? (Fails: values near the cut change.)

## References
- [Polars: rolling_mean](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.rolling_mean.html) (unverified): windows, `min_samples` and nulls.
- [Polars: ewm_mean](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.ewm_mean.html) (unverified): exponential weighting and the `adjust` option.
- [pandas: Windowing operations](https://pandas.pydata.org/docs/user_guide/window.html): documents `center` and why it is two-sided.
- [Investor.gov: Moving averages (glossary)](https://www.investor.gov/introduction-investing/investing-basics/glossary) (unverified): plain definition. Facts only; no claim that any indicator predicts prices.
- John C. Hull, *Options, Futures, and Other Derivatives* (book): log returns and annualised volatility.
