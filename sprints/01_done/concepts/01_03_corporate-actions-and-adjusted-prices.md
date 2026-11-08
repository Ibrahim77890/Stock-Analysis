# Corporate actions and adjusted prices

**Sprint:** 01    **Used by tasks:** 01_02, 01_04, 01_05, 01_06

## Why this matters for MarketLab
A 4-for-1 stock split makes the price drop ~75% overnight although no investor lost money. A naive backtest sees a crash. Adjusted prices fix this, but **backward-adjusted prices are computed using future events**, so using them in replay or backtests leaks the future. This is one of the central correctness issues of the whole product (blueprint 23.3).

## Plain-language explanation
- **Split**: a company turns 1 share into N. Price divides by N, shares multiply by N. Value unchanged.
- **Cash dividend**: on the *ex-dividend date* the price drops by about the dividend amount.
- **Raw (unadjusted) price**: what actually traded on that day.
- **Adjusted price**: raw price multiplied by a factor so the series is continuous across actions. Factors for old dates depend on later events.

Example: raw closes 400 (day 1), then a 4-for-1 split, raw close 101 (day 2). Split-adjusted day 1 = 400/4 = 100. The return is 101/100-1 = +1%, not -74.75%.

**Decision for MarketLab:** store **raw** bars and the **corporate actions** separately; compute adjusted series on demand, *as of* a date. Never mix them in one column without a label.

## Key terms
- **Split ratio**, **ex-dividend date**, **adjustment factor**, **split-adjusted vs total-return (dividend-adjusted)**.
- **Symbol change / delisting / merger**: identity changes; the symbol alone is not a stable key.

## Common mistakes / pitfalls
- Mixing adjusted and raw prices in one table.
- Believing "adjusted close" from a provider is the same across providers.
- Using today's adjusted history inside a historical replay.
- Using the ticker as a permanent identifier.

## What to implement in this domain
- Request **raw** bars (`adjustment=raw` on Alpaca) and record the adjustment mode in the manifest (task 01_04).
- Fetch the provider's corporate-action records for the universe and save them as a raw file (task 01_04).
- In the exploration, find at least one split in the data and show a price jump (task 01_05).
- Table `market.instrument` uses a surrogate `instrument_id` and holds the symbol as an attribute (task 01_06).

## How to check you understood
1. Raw close 90 before a 3-for-1 split, raw close 31 after. Split-adjusted close before? (30; return is +3.3%.)
2. Why does a dividend-adjusted 2010 price change when the company pays a dividend in 2024? (Factors for earlier dates include later dividends.)

## References
- [Investopedia: Stock split](https://www.investopedia.com/terms/s/stocksplit.asp) (unverified: site blocks automated checks).
- [Investopedia: Adjusted closing price](https://www.investopedia.com/terms/a/adjusted_closing_price.asp) (unverified: site blocks automated checks).
- [Alpaca: Corporate actions API](https://docs.alpaca.markets/reference/corporateactions-1): provider endpoint for splits/dividends.
- [Alpaca: Stock bars API reference](https://docs.alpaca.markets/reference/stockbars): the `adjustment` parameter (`raw`, `split`, `dividend`, `all`).
- [FINRA: Stocks](https://www.finra.org/investors/investing/investment-products/stocks): regulator's overview of stock basics.
