# Adjusted prices computed as-of a date

**Sprint:** 02    **Used by tasks:** 02_02, 02_03, 02_04, 02_06

## Why this matters for MarketLab
Sprint 01 stores raw prices and corporate actions separately. The first thing a learner chart or backtest needs is a continuous price series, and the easy way to get one (a provider's "adjusted close") quietly uses actions that happen *after* each bar, which is look-ahead. This concept is the rule for building adjusted series without leaking the future (blueprint 23.3 item 1).

## Plain-language explanation
A 4-for-1 split on 2020-08-31 makes the raw close fall from 499.345 (2020-08-28) to 129.11 (2020-08-31). Nothing economic happened; the share count changed. To compare, scale the old prices: 499.345 / 4 = 124.836. The scale factor for every bar *before* the ex-date is 1/4; bars on or after it keep factor 1.

The key question is "adjusted as of when?". A series adjusted as of 2020-09-15 uses the split. A series adjusted as of 2020-08-20 must **not** use it, because on 2020-08-20 nobody knew about the future split announcement being effective (an announcement may precede the ex-date, but this project uses only the ex-date as the point at which the action takes effect). So the factor for bar date *t* at cursor date *D* is the product of the ratios of all actions with `t < ex_date <= D`.

Dividends work the same way with factor `1 - dividend / close_before_ex_date`. Split-only adjustment is the minimum; dividend adjustment is optional and must be an explicit, named mode.

Numeric example: bars at 100 (day 1), 102 (day 2), 26 (day 3, ex-date of 4-for-1). As of day 2: factors 1, 1 -> 100, 102 (the split has not happened). As of day 3: factors 0.25, 0.25, 1 -> 25, 25.5, 26. The day-3 return is +2.0% (26 / 25.5), not -74.5%.

## Key terms
- Raw price: as traded on that date.
- Split adjustment factor: `split_from / split_to` (4-for-1 -> 0.25) applied to bars before the ex-date.
- As-of date / cursor: the latest date the viewer is allowed to know; only actions with `ex_date <= as_of` count.
- Cumulative factor: product of the factors of all qualifying actions after the bar.
- Total-return vs price-only adjustment: whether dividends are folded in.
- Backward-adjusted series: history rescaled to the latest price level (leaks future actions into old values).

## Common mistakes / pitfalls
- Using a provider's adjusted close in a replay or backtest.
- Applying an action to the bar on the ex-date instead of the bars before it (off-by-one).
- Using the announcement date or the record date instead of the ex-date.
- Rounding factors early; keep full precision and round only on output.
- Mixing adjusted and raw rows in one series (blueprint 26.2 item 2).
- Forgetting that reverse splits (factor > 1) exist (GE 1-for-8 in the data).

## What to implement in this domain
- A pure function in the Python service (where the project owner keeps domain logic) that takes raw bars, a list of corporate actions and an `as_of` date and returns a factor per bar date and the adjusted OHLC.
- Explicit adjustment modes: `raw`, `split`, `split_dividend`.
- Volume adjusted inversely to price for splits (shares multiply), or explicitly left raw and documented.
- Golden tests with hand-computed numbers (AAPL 4-for-1, NVDA 10-for-1, GE reverse split).
- Causality invariant: the adjusted value of any bar at `as_of = D` must not change when actions with `ex_date > D` are added.

## How to check you understood
1. Raw closes 400, then 100 after a 4-for-1 on day 2. What are the adjusted closes as of day 1 and as of day 2? (As of day 1: 400. As of day 2: 100 and 100.)
2. Why is a provider's adjusted close wrong for a replay on day 1? (It already contains the day-2 split, so day-1 values depend on the future.)
3. A stock pays 1.00 when the previous close was 50. What is the dividend factor for earlier bars? (`1 - 1/50 = 0.98`.)

## References
- [SEC Investor.gov: Stock splits](https://www.investor.gov/introduction-investing/investing-basics/glossary/stock-split) (unverified): what a split does to share count and price.
- [Investor.gov glossary](https://www.investor.gov/introduction-investing/investing-basics/glossary): ex-dividend date and related terms.
- [CRSP Data Descriptions, price and return adjustment factors](https://www.crsp.org/) (unverified): how a primary academic source defines cumulative factors to adjust shares and prices.
- [Alpaca docs: historical stock data, adjustments](https://docs.alpaca.markets/docs/historical-stock-data-1) (unverified): what `raw`, `split`, `dividend` and `all` mean in the provider this project uses.
- Marcos Lopez de Prado, *Advances in Financial Machine Learning*, ch. 2 (book): the argument against back-adjusted series for research. Interpretation (author's view), not a standard.
