# Price return vs total return, and dividend adjustment as of a date

**Sprint:** 05    **Used by tasks:** 05_06, 05_09

## Why this matters for MarketLab
Sprint 03 backtests use split-adjusted prices only, so they ignore dividends. A buy-and-hold of a dividend-paying stock then looks worse than it was, and a rule that sits in cash misses nothing it should not. For honest comparison the engine needs a **total return** basis, built without leaking future dividends.

## Plain-language explanation
**Price return** counts only the change in price. **Total return** also counts the cash dividends (assumed reinvested). On the ex-dividend date the price falls by about the dividend, so a price-only series shows a loss that the investor did not suffer.

Our Sprint 02 `split_dividend` mode multiplies earlier prices by `(prev_close - dividend) / prev_close` for each later ex-date (and the split factors). Example: close 100 the day before an ex-date, dividend 2: factor 0.98, so every earlier price is multiplied by 0.98; the ex-date close of 98 then looks like a 0% move.

**Why this is safe for the backtest.** Adjusted as of the run's end date, every bar's price is the as-of-day-t price times one constant (the product of factors for actions after t). A rule that compares ratios of prices (SMA fast above SMA slow, returns) is unchanged by a constant scale, and with fractional shares equity is unchanged too. This is the same argument as for splits in ADR 0009, and it is tested by the truncation test: equity at t from the full run equals equity at t from a run ending at t.

**Careful:** rules that use absolute price levels (for example "price above 50") would be wrong on adjusted prices; the engine's SMA crossover is not such a rule.

## Key terms
- price return / total return.
- ex-dividend date: first day the buyer does not get the dividend.
- dividend factor: `(prev_close - dividend) / prev_close`.
- price basis: which adjusted series the engine uses (`split` or `split_dividend`).
- reinvestment assumption: dividends are assumed reinvested at the ex-date close.

## Common mistakes / pitfalls
- Using the vendor's `adjClose` (full-sample as of today) instead of our as-of series.
- Comparing a total-return strategy with a price-return benchmark.
- Changing the price basis without changing the hash (old and new results would look identical).
- Forgetting that dividends remove cash-like behaviour from the "flat" periods (cash earns nothing in the engine).

## What to implement in this domain
- A spec field `price_basis` with values `split` (default) and `split_dividend`; the engine receives the matching adjusted bars. Hashes of existing `split` runs must not change: add the field to the canonical spec only when it is not the default.
- Truncation (causality) test with `split_dividend` across a dividend and the AAPL split.
- Comparison table price-only vs total return for buy-and-hold and for SMA 20/50 on SPY and AAPL.
- External check: our as-of-end `split_dividend` adjusted close divided by Tiingo's `adjClose` is constant (close to 1) over time for symbols with dividends; report the spread.

## How to check you understood
1. Close 50, ex-date dividend 1 on the next day. What factor applies to earlier prices? (0.98.)
2. Why must the old run hashes stay valid after adding `price_basis`? (Otherwise stored runs would silently stop reproducing.)
3. Why is the SMA crossover insensitive to the as-of-end scale? (Both averages scale by the same constant.)

## References
- [Wikipedia: Total return](https://en.wikipedia.org/wiki/Total_return): definition.
- [Wikipedia: Ex-dividend date](https://en.wikipedia.org/wiki/Ex-dividend_date): price behaviour around the ex-date.
- [Tiingo: end-of-day documentation](https://www.tiingo.com/documentation/end-of-day): description of the vendor's adjusted fields.
- Project: ADR 0005 (as-of adjustment) and ADR 0009 (scale-invariance argument).
