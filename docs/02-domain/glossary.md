# MarketLab glossary (Sprint 01)

All terms below are **mechanic** (established fact) unless labelled **interpretation**. Sources are
first-party glossaries; deep links were not individually verified (marked `(unverified)`), so check the
term on the source's glossary page before quoting.

Sources used: [Investor.gov glossary](https://www.investor.gov/introduction-investing/investing-basics/glossary), [FINRA investor education](https://www.finra.org/investors), [SEC](https://www.sec.gov), [NYSE trading hours](https://www.nyse.com/markets/hours-calendars). All `(unverified)` deep links resolve to these roots.

| # | Term | Definition | Example | Level | Type | Related | Source |
|---|---|---|---|---|---|---|---|
| 1 | stock | A share of ownership in a company. | AAPL is a share of Apple Inc. | beginner | mechanic | ETF, exchange | Investor.gov (unverified) |
| 2 | ETF | An exchange-traded fund: a basket of securities that trades like a stock. | SPY holds the S&P 500 constituents. | beginner | mechanic | stock, index | Investor.gov (unverified) |
| 3 | index | A calculated measure of a group of securities; not directly tradable. | S&P 500. | beginner | mechanic | ETF | Investor.gov (unverified) |
| 4 | exchange | A regulated venue where securities are matched and traded. | NYSE (calendar code XNYS). | beginner | mechanic | trading session | SEC (unverified) |
| 5 | broker | A firm that executes orders for customers. | Alpaca is a broker that also provides market data. | beginner | mechanic | market order | Investor.gov (unverified) |
| 6 | market maker | A firm that continuously quotes bid and ask prices and provides liquidity. | Quoting 99.98 / 100.02. | intermediate | mechanic | bid, ask, spread | FINRA (unverified) |
| 7 | bid | The highest price a buyer currently offers. | Bid 99.98. | beginner | mechanic | ask, spread | Investor.gov (unverified) |
| 8 | ask | The lowest price a seller currently accepts. | Ask 100.02. | beginner | mechanic | bid, spread | Investor.gov (unverified) |
| 9 | spread | Ask minus bid; a cost of trading immediately. | 100.02 - 99.98 = 0.04. | beginner | mechanic | bid, ask, liquidity | Investor.gov (unverified) |
| 10 | volume | Number of shares traded in a period. | 52,000,000 shares on one day. | beginner | mechanic | OHLCV, liquidity | Investor.gov (unverified) |
| 11 | liquidity | How easily an asset can be traded without moving its price. | SPY is far more liquid than a micro-cap. | intermediate | mechanic | spread, volume | FINRA (unverified) |
| 12 | market order | An order to buy/sell immediately at the best available price. | Buy 10 shares now. | beginner | mechanic | limit order | Investor.gov (unverified) |
| 13 | limit order | An order to trade only at a given price or better. | Buy at 99.00 or lower. | beginner | mechanic | market order | Investor.gov (unverified) |
| 14 | stop order | An order that becomes a market order once a trigger price trades. | Sell if price falls to 95. | beginner | mechanic | market order | Investor.gov (unverified) |
| 15 | OHLCV | Open, high, low, close prices and volume for one time bucket. | O 100, H 103, L 99, C 102, V 1.2M. | beginner | mechanic | candlestick, timeframe | Investor.gov (unverified) |
| 16 | candlestick | A chart glyph showing one bar's OHLC (body open-close, wicks high-low). | Green body when close > open. | beginner | mechanic | OHLCV | Investor.gov (unverified) |
| 17 | timeframe | The length of time one bar covers. | 1Day, 1Min. | beginner | mechanic | OHLCV | Alpaca docs (unverified) |
| 18 | trading session | The period an exchange is open for regular trading (NYSE: 09:30-16:00 New York). | Mon 2023-11-20 is a session; Thu 2023-11-23 is not. | beginner | mechanic | trade date, pre-market | NYSE (unverified) |
| 19 | trade date | The exchange-local calendar date of a session; a date, not an instant. | 2020-08-31 | beginner | mechanic | trading session | project definition |
| 20 | pre-market | Trading before the regular session opens (outside regular hours). | 04:00-09:30 New York. | beginner | mechanic | after-hours | Investor.gov (unverified) |
| 21 | after-hours | Trading after the regular session closes. | 16:00-20:00 New York. | beginner | mechanic | pre-market | Investor.gov (unverified) |
| 22 | split | A corporate action that multiplies shares and divides price by the same factor. | 4-for-1: 1 share at 400 becomes 4 at 100. | beginner | mechanic | adjusted price, ex-date | SEC (unverified) |
| 23 | dividend | A cash payment from a company to shareholders. | 0.22 per share. | beginner | mechanic | ex-dividend date | Investor.gov (unverified) |
| 24 | ex-dividend date | First day a purchase no longer earns the upcoming dividend; price typically drops by about the dividend. | Ex-date 2023-11-10. | intermediate | mechanic | dividend | SEC (unverified) |
| 25 | delisting | Removal of a security from an exchange. | A bankrupt company's stock is delisted. | intermediate | mechanic | survivorship bias | SEC (unverified) |
| 26 | survivorship bias | Error from analysing only securities that still exist today, ignoring delisted ones. | Today's index members looked better than the index back then. | intermediate | mechanic | delisting | academic literature (unverified) |
| 27 | look-ahead bias | Error from using information in a test that was not available at that time. | Using today's close to decide yesterday's trade. | intermediate | mechanic | replay boundary | academic literature (unverified) |
| 28 | adjusted price | A historical price rescaled for splits/dividends so the series is comparable over time. | Pre-split 400 shown as 100 for a 4-for-1. | intermediate | mechanic | raw price, split | Investor.gov (unverified) |
| 29 | raw price | The price actually traded on that date, unmodified. | AAPL closed about 129 on 2020-08-28. | beginner | mechanic | adjusted price | project definition |
| 30 | quarantine | Our holding table for rows that failed validation; kept with a reason, never deleted. | A bar with high < close. | beginner | mechanic | data quality | project definition |
| 31 | idempotent load | Loading the same input twice leaves the database unchanged. | Second run: 0 inserts, 0 updates. | intermediate | mechanic | quarantine | project definition |
| 32 | provenance | A record of where data came from, when, and with which parameters (the manifest). | Provider, retrieved_at, sha256. | intermediate | mechanic | manifest | project definition |
| 33 | cursor | The latest trading date a replay viewer may see; the server returns nothing after it. | Cursor 2020-06-30: bars up to that day only. | intermediate | mechanic | as-of, replay boundary | project definition |
| 34 | as-of | Computing a value using only information available on a given date. | Adjusted as of 2020-08-28: the 2020-08-31 split is not used. | intermediate | mechanic | cursor, adjusted price | project definition |
| 35 | causal | An indicator whose value at time t depends only on data up to t. | SMA(3) on day 3 uses days 1-3. | intermediate | mechanic | look-ahead bias, truncation test | project definition |
| 36 | truncation test | Check that a value computed on the full series equals the value computed on the series cut at that time. | SMA at t from full data == SMA at t from data[:t+1]. | intermediate | mechanic | causal | project definition |
| 37 | lineage | The traceable path from a stored bar to its provider, file hash and loader job. | AAPL bars -> job 3 -> AAPL.parquet sha256. | intermediate | mechanic | provenance | project definition |
| 38 | SIP | Securities Information Processor: the consolidated tape combining trades from all US venues. | Consolidated volume comes from the SIP. | intermediate | mechanic | IEX, volume | SEC (unverified) |
| 39 | IEX | Investors Exchange, one US equity venue; its data feed covers only trades on IEX. | IEX volume is a small share of the day's total. | intermediate | mechanic | SIP, volume | IEX Exchange (unverified) |
| 40 | reverse split | A split that reduces share count and multiplies price. | 1-for-8: price 10 becomes 80. | intermediate | mechanic | split | SEC (unverified) |
| 41 | adjustment factor | The multiplier applied to an earlier raw price to make it comparable after corporate actions. | 4-for-1 split: 0.25. | intermediate | mechanic | adjusted price, split | project definition |
