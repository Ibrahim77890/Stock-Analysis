# OHLCV bars and candlesticks

**Sprint:** 01    **Used by tasks:** 01_02, 01_05, 01_06, 01_08

## Why this matters for MarketLab
Every chart, indicator, replay and backtest in MarketLab is built from bars. If you misread what a bar means (when it opens, what volume counts, which feed it came from) every later result is subtly wrong, and you will not notice.

## Plain-language explanation
A **bar** summarises all trades in a time window (a minute, a day) into five numbers: **O**pen (first trade price), **H**igh (highest), **L**ow (lowest), **C**lose (last trade), **V**olume (shares traded). A **candlestick** is just a drawing of a bar: the body spans open to close, thin "wicks" reach the high and low; it is green/bullish if close > open, red/bearish otherwise.

Example: a day opens at 100.00, trades up to 103.50, down to 99.20, closes at 102.00 with 1,200,000 shares. Then O=100, H=103.5, L=99.2, C=102, V=1.2M; it is bullish with an upper wick of 1.5 and a lower wick of 0.8.

A bar tells you nothing about the **order** in which the high and low happened inside the window.

## Key terms
- **OHLCV**: open, high, low, close, volume.
- **Timeframe / resolution**: window length (1m, 5m, 1d).
- **Bar timestamp**: for intraday bars, usually the window **start**; check each provider. A daily bar is identified by a *trading date*, not an instant.
- **Feed (IEX vs SIP/consolidated)**: IEX is one exchange; SIP combines all exchanges. IEX volume is only a small fraction of total volume.
- **Regular hours**: 09:30-16:00 New York time; pre-market and after-hours are extended sessions.

## Common mistakes / pitfalls
- Treating `high >= open, close` as always true in dirty data; it is a rule to **check**, not assume.
- Comparing volume across providers/feeds.
- Assuming the daily bar's date is an instant or a UTC date.
- Assuming you can tell from a daily bar whether the stop or the target was hit first (you cannot).

## What to implement in this domain
- A data dictionary entry for `bar_daily` listing every column, type, unit, nullability, and meaning (task 01_02).
- Store prices as exact decimals (`NUMERIC`), volume as integer (task 01_06).
- Validation of OHLC relationships and non-negative volume (task 01_08).

## How to check you understood
1. A bar has O=50, H=49, L=48, C=48.5. Is it valid? (No: High is below Open.)
2. Which provider-specific fact must you record before comparing the volume of two datasets? (The feed.)
3. Is a candle with C=O bullish or bearish? (Neither: a doji; define your convention in the glossary.)

## References
- [Investopedia: Candlestick](https://www.investopedia.com/terms/c/candlestick.asp) (unverified: site blocks automated checks): visual anatomy of a candle.
- [Investor.gov glossary](https://www.investor.gov/introduction-investing/investing-basics/glossary): official plain-language definitions of market terms.
- [Alpaca: Historical stock data](https://docs.alpaca.markets/docs/historical-stock-data-1): how bars, feeds (IEX vs SIP) and timestamps are defined by the provider we will use.
- [Alpaca: Stock bars API reference](https://docs.alpaca.markets/reference/stockbars): fields, `adjustment` and `feed` parameters.
