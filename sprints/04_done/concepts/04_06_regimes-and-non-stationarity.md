# Regimes and non-stationarity

**Sprint:** 04    **Used by tasks:** 04_07

## Why this matters for MarketLab
A single total return hides where it came from. A rule can earn all its profit in one year or one volatility regime and lose in the rest. Splitting results by year and by volatility level shows whether an average describes anything stable. This is the "regime breakdown" feature of blueprint 23.2 and the idea of non-stationarity behind most backtest failures.

## Plain-language explanation
**Non-stationary** means the statistical behaviour of prices (average return, volatility, correlation) changes over time. A rule tuned in one **regime** (for example calm and rising, or high volatility) can fail in another.

Two simple, checkable breakdowns:
1. **By calendar year:** attribute each day's strategy return to its year.
2. **By volatility level:** label each day by the trailing 20-day volatility of the asset known at the previous close (low / medium / high terciles), then attribute each day's strategy return to its label.

Reconciliation: the **growth factor** of each group is the product of `(1 + daily return)` over its days. The product of the groups' growth factors equals the whole run's growth factor, so no return disappears or is counted twice. Example: +20% in 2021 and -5% in 2022 gives `1.20 * 0.95 = 1.14`, a +14% total.

Labelling by terciles of the full sample is a **descriptive** (hindsight) analysis because the tercile thresholds use all data. The labels themselves use only information available at each decision date, but the thresholds do not; say so in the output. A causal alternative is an expanding-window percentile (deferred).

## Key terms
- regime: a period with a distinct statistical character.
- stationarity: constant statistical properties over time.
- trailing volatility: standard deviation of recent returns, annualised.
- attribution: assigning part of a total result to a period or a label.
- growth factor: product of `(1 + r)` over a set of days.

## Common mistakes / pitfalls
- Summing percentage returns across groups instead of multiplying growth factors.
- Labelling a day with the same day's volatility (includes the return being attributed) instead of the previous close's.
- Reading a regime table from a short sample as a stable property (each cell may hold a handful of trades).
- Choosing regime definitions after seeing which one makes the rule look best (another trial).

## What to implement in this domain
- `regime_breakdown(result, bars, by="year" | "volatility")` returning per group: days, share of days in the market, growth factor, return, and the number of trades that started in the group.
- A reconciliation check inside the function: the product of group growth factors equals total growth within 1e-9, otherwise raise.
- Label volatility with `indicators.rolling_volatility` shifted by one day.
- Tests: golden hand-computed table; reconciliation on real AAPL; labels never use the same day's return (change today's close and yesterday's label stays); unknown `by` rejected.

## How to check you understood
1. Why multiply growth factors instead of adding returns? (Returns compound.)
2. Why shift the volatility label by one day? (Today's volatility includes today's return, which is what is being attributed.)
3. A rule earns all its profit in a single year. What do you conclude? (The average is not representative; treat it as one-regime evidence.)

## References
- [Wikipedia: Stationary process](https://en.wikipedia.org/wiki/Stationary_process): definition of stationarity.
- [Wikipedia: Volatility clustering](https://en.wikipedia.org/wiki/Volatility_clustering): calm and turbulent periods tend to persist (an empirical regularity).
- [Polars: rolling_std](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.rolling_std.html): the building block for trailing volatility.
- [NumPy: percentile](https://numpy.org/doc/stable/reference/generated/numpy.percentile.html): computing tercile thresholds.
