# Long-window validation example (generated 2026-11-08 18:17 UTC)

Produced by `scripts/reports/long_window_example.py` from the loaded data; every number is copied from that run. It repeats the Sprint 04 questions on a much longer history and **is not evidence of a profitable strategy**. Sharpe values are annualised; costs are 1 bp commission + 2 bps slippage per fill; the universe is survivorship-biased; the engine's idle cash earns 0 while the excess-Sharpe column subtracts the previous day's 3-month Treasury yield (a downward bias for in-and-out rules). Environment: Windows-11-10.0.26300-SP0, Python 3.14.10. Grid: fast in 3, 5, 10, 20, 30 and slow in 20, 30, 50, 100, 150 with fast < slow = 22 pairs.

Data: Alpaca IEX and Tiingo end-of-day (internal use only; no price data are in this page), FRED DGS3MO and VIXCLS. This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.

Set-ups: A: Alpaca IEX, split, 5.4 years; B: Tiingo, split, same 5.4 years; C: Tiingo, split + dividend, 21 years. Windows are scaled to the data: split train/holdout bars A,B = 1,000/200 and C = 2,500/1,000; walk-forward train/test A,B = 500/100 and C = 1,000/250; embargo 5 everywhere.

## Coverage of the long window

| Symbol | Tiingo first date | Tiingo bars | Covers 2005-01-03 | Alpaca bars (IEX) |
|---|---|---|---|---|
| AAPL | 2005-01-03 | 5283 | yes | 1366 |
| AMD | 2005-01-03 | 5283 | yes | 1366 |
| AMT | 2005-01-03 | 5283 | yes | 1363 |
| AMZN | 2005-01-03 | 5283 | yes | 1366 |
| AVGO | 2009-08-06 | 4127 | no | 1366 |
| BA | 2005-01-03 | 5283 | yes | 1363 |
| BAC | 2005-01-03 | 5283 | yes | 1363 |
| BRK.B | 2005-01-03 | 5283 | yes | 1363 |
| CAT | 2005-01-03 | 5283 | yes | 1363 |
| COST | 2005-01-03 | 5283 | yes | 1366 |
| CRM | 2005-01-03 | 5283 | yes | 1363 |
| CVX | 2005-01-03 | 5283 | yes | 1363 |
| DIA | 2005-01-03 | 5283 | yes | 1366 |
| DIS | 2005-01-03 | 5283 | yes | 1364 |
| GE | 2005-01-03 | 5283 | yes | 1364 |
| GLD | 2005-01-03 | 5283 | yes | 1366 |
| GOOGL | 2005-01-03 | 5283 | yes | 1366 |
| GS | 2005-01-03 | 5283 | yes | 1363 |
| HD | 2005-01-03 | 5283 | yes | 1363 |
| INTC | 2005-01-03 | 5283 | yes | 1366 |
| IWM | 2005-01-03 | 5283 | yes | 1366 |
| JNJ | 2005-01-03 | 5283 | yes | 1363 |
| JPM | 2005-01-03 | 5283 | yes | 1363 |
| KO | 2005-01-03 | 5283 | yes | 1364 |
| LIN | 2018-10-01 | 1823 | no | 1363 |
| LLY | 2005-01-03 | 5283 | yes | 1363 |
| MCD | 2005-01-03 | 5283 | yes | 1363 |
| META | 2012-05-18 | 3425 | no | 1366 |
| MRK | 2005-01-03 | 5283 | yes | 1363 |
| MSFT | 2005-01-03 | 5283 | yes | 1366 |
| NEE | 2005-01-03 | 5283 | yes | 1363 |
| NFLX | 2005-01-03 | 5283 | yes | 1366 |
| NKE | 2005-01-03 | 5283 | yes | 1363 |
| NVDA | 2005-01-03 | 5283 | yes | 1366 |
| ORCL | 2005-01-03 | 5283 | yes | 1363 |
| PFE | 2005-01-03 | 5283 | yes | 1363 |
| PG | 2005-01-03 | 5283 | yes | 1363 |
| QQQ | 2005-01-03 | 5283 | yes | 1366 |
| SPY | 2005-01-03 | 5283 | yes | 1367 |
| T | 2005-01-03 | 5283 | yes | 1362 |
| TLT | 2005-01-03 | 5283 | yes | 1366 |
| TSLA | 2010-06-29 | 3902 | no | 1366 |
| UNH | 2005-01-03 | 5283 | yes | 1363 |
| UPS | 2005-01-03 | 5283 | yes | 1363 |
| V | 2008-03-19 | 4476 | no | 1363 |
| WMT | 2005-01-03 | 5283 | yes | 1363 |
| XLE | 2005-01-03 | 5283 | yes | 1366 |
| XLF | 2005-01-03 | 5283 | yes | 1366 |
| XLK | 2005-01-03 | 5283 | yes | 1366 |
| XLP | 2005-01-03 | 5283 | yes | 1366 |
| XLV | 2005-01-03 | 5283 | yes | 1366 |
| XLY | 2005-01-03 | 5283 | yes | 1366 |
| XOM | 2005-01-03 | 5283 | yes | 1363 |

48 symbols cover 2005-01-03 (AAPL, AMD, AMT, AMZN, BA, BAC, BRK.B, CAT, COST, CRM, CVX, DIA, DIS, GE, GLD, GOOGL, GS, HD, INTC, IWM, JNJ, JPM, KO, LLY, MCD, MRK, MSFT, NEE, NFLX, NKE, NVDA, ORCL, PFE, PG, QQQ, SPY, T, TLT, UNH, UPS, WMT, XLE, XLF, XLK, XLP, XLV, XLY, XOM). Not covering it: AVGO, LIN, META, TSLA, V (their ETF/IPO history starts later; they are left out of the long-window scan, not dropped silently).

## SPY

### SPY, set-up A: Alpaca IEX, split, 5.4 years (1366 bars, 2020-07-27 to 2025-12-31, 5.4 years)

Split (22 trials): selected **3/20** on the training bars only.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample | 2020-07-27 to 2024-07-17 | 48.1% | 0.94 | 29 |
| Out-of-sample | 2024-07-25 to 2025-03-10 | 0.0% | 0.05 | 4 |
| Holdout (one use) | 2025-03-18 to 2025-12-31 | 12.0% | 1.43 | 7 |

Decay (in-sample minus out-of-sample Sharpe): **0.89**. Overfitting meter: N = 22 trials, best train Sharpe 0.94, expected best under no skill 0.31, DSR 0.907, PSR(0) 0.974.

Walk-forward (8 folds, 176 trials): stitched out-of-sample return 24.6%, Sharpe 0.72, max drawdown -17.8%, 20 trades; the selected pair changed 3 times.

### SPY, set-up B: Tiingo, split, same 5.4 years (1366 bars, 2020-07-27 to 2025-12-31, 5.4 years)

Split (22 trials): selected **3/20** on the training bars only.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample | 2020-07-27 to 2024-07-17 | 48.1% | 0.93 | 29 |
| Out-of-sample | 2024-07-25 to 2025-03-10 | 0.1% | 0.07 | 4 |
| Holdout (one use) | 2025-03-18 to 2025-12-31 | 12.2% | 1.44 | 7 |

Decay (in-sample minus out-of-sample Sharpe): **0.87**. Overfitting meter: N = 22 trials, best train Sharpe 0.93, expected best under no skill 0.30, DSR 0.910, PSR(0) 0.974.

Walk-forward (8 folds, 176 trials): stitched out-of-sample return 21.7%, Sharpe 0.64, max drawdown -17.7%, 20 trades; the selected pair changed 4 times.

### SPY, set-up C: Tiingo, split + dividend, 21 years (5283 bars, 2005-01-03 to 2025-12-31, 21.0 years)

Split (22 trials): selected **10/150** on the training bars only.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample | 2005-01-03 to 2014-12-05 | 116.1% | 0.76 | 19 |
| Out-of-sample | 2014-12-15 to 2021-12-29 | 92.1% | 0.78 | 8 |
| Holdout (one use) | 2022-01-06 to 2025-12-31 | 25.8% | 0.57 | 8 |

Decay (in-sample minus out-of-sample Sharpe): **-0.02**. Overfitting meter: N = 22 trials, best train Sharpe 0.76, expected best under no skill 0.30, DSR 0.928, PSR(0) 0.992.

Walk-forward (17 folds, 374 trials): stitched out-of-sample return 398.2%, Sharpe 0.88, max drawdown -18.6%, 65 trades; the selected pair changed 10 times.

### SPY: price basis and risk-free rate (fixed SMA 20/50, full window of each set-up)

| Set-up | Series | Total return | CAGR | Sharpe (rf 0) | Sharpe (excess) | Max drawdown | Trades |
|---|---|---|---|---|---|---|---|
| A | SMA 20/50 | 30.2% | 5.0% | 0.48 | 0.21 | -29.8% | 12 |
| A | buy and hold | 111.3% | 14.8% | 0.90 | 0.72 | -25.4% | 1 |
| B | SMA 20/50 | 32.7% | 5.4% | 0.51 | 0.24 | -29.8% | 12 |
| B | buy and hold | 111.4% | 14.8% | 0.89 | 0.71 | -25.4% | 1 |
| C | SMA 20/50 | 249.8% | 6.2% | 0.57 | 0.42 | -28.3% | 53 |
| C | buy and hold | 734.3% | 10.7% | 0.63 | 0.53 | -55.2% | 1 |

Price return vs total return on the long window (SMA 20/50, buy and hold): split only: strategy 159.2%, buy and hold 465.9%; split + dividend: strategy 249.8%, buy and hold 734.3%. The engine's cash earns 0 and dividends are credited through adjusted prices, so the total-return figure counts them only while the strategy holds the stock.

### SPY: regimes by calendar year (SMA 20/50, set-up C)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| 2005 | 252 | 48.4% | 2.4% | 4 |
| 2006 | 251 | 82.9% | 14.4% | 1 |
| 2007 | 251 | 64.5% | -6.2% | 3 |
| 2008 | 253 | 24.5% | -6.4% | 2 |
| 2009 | 252 | 79.0% | 13.9% | 3 |
| 2010 | 252 | 66.3% | 1.8% | 3 |
| 2011 | 252 | 58.3% | -12.9% | 4 |
| 2012 | 250 | 70.4% | 15.3% | 2 |
| 2013 | 252 | 88.5% | 22.6% | 2 |
| 2014 | 252 | 79.8% | -3.4% | 3 |
| 2015 | 252 | 61.9% | -2.3% | 4 |
| 2016 | 252 | 63.5% | 10.3% | 3 |
| 2017 | 251 | 95.6% | 18.5% | 2 |
| 2018 | 251 | 58.2% | 6.5% | 1 |
| 2019 | 252 | 74.6% | 11.5% | 3 |
| 2020 | 253 | 78.7% | 21.8% | 2 |
| 2021 | 252 | 92.5% | 22.2% | 1 |
| 2022 | 251 | 40.6% | -22.9% | 3 |
| 2023 | 250 | 61.2% | 8.6% | 3 |
| 2024 | 252 | 87.3% | 16.7% | 2 |
| 2025 | 250 | 75.6% | 11.7% | 2 |

Product of group growth factors 3.497557 = total growth 3.497557. Calendar-year attribution.

### SPY: regimes by VIX bucket (previous close; low < 15, medium 15 to 25, high >= 25) (SMA 20/50, set-up C)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| low | 1986 | 84.2% | 65.9% | 23 |
| medium | 2429 | 67.3% | 62.9% | 25 |
| high | 868 | 39.9% | 29.4% | 5 |

Product of group growth factors 3.497557 = total growth 3.497557. VIX buckets are fixed in advance (low < 15, medium 15 to 25, high >= 25) and use the previous trading day's VIXCLS close; 'unknown' = no earlier observation. This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.

## AAPL

### AAPL, set-up A: Alpaca IEX, split, 5.4 years (1366 bars, 2020-07-27 to 2025-12-31, 5.4 years)

Split (22 trials): selected **5/20** on the training bars only.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample | 2020-07-27 to 2024-07-17 | 94.0% | 0.93 | 26 |
| Out-of-sample | 2024-07-25 to 2025-03-10 | 0.9% | 0.17 | 5 |
| Holdout (one use) | 2025-03-18 to 2025-12-31 | -13.4% | -0.81 | 7 |

Decay (in-sample minus out-of-sample Sharpe): **0.76**. Overfitting meter: N = 22 trials, best train Sharpe 0.93, expected best under no skill 0.42, DSR 0.858, PSR(0) 0.971.

Walk-forward (8 folds, 176 trials): stitched out-of-sample return 57.4%, Sharpe 0.86, max drawdown -21.1%, 20 trades; the selected pair changed 4 times.

### AAPL, set-up B: Tiingo, split, same 5.4 years (1366 bars, 2020-07-27 to 2025-12-31, 5.4 years)

Split (22 trials): selected **5/20** on the training bars only.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample | 2020-07-27 to 2024-07-17 | 98.3% | 0.96 | 26 |
| Out-of-sample | 2024-07-25 to 2025-03-10 | 0.6% | 0.14 | 5 |
| Holdout (one use) | 2025-03-18 to 2025-12-31 | -13.2% | -0.80 | 7 |

Decay (in-sample minus out-of-sample Sharpe): **0.82**. Overfitting meter: N = 22 trials, best train Sharpe 0.96, expected best under no skill 0.42, DSR 0.869, PSR(0) 0.975.

Walk-forward (8 folds, 176 trials): stitched out-of-sample return 65.7%, Sharpe 0.95, max drawdown -21.1%, 17 trades; the selected pair changed 4 times.

### AAPL, set-up C: Tiingo, split + dividend, 21 years (5283 bars, 2005-01-03 to 2025-12-31, 21.0 years)

Split (22 trials): selected **5/150** on the training bars only.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample | 2005-01-03 to 2014-12-05 | 2066.4% | 1.31 | 10 |
| Out-of-sample | 2014-12-15 to 2021-12-29 | 316.7% | 0.95 | 15 |
| Holdout (one use) | 2022-01-06 to 2025-12-31 | 8.1% | 0.20 | 12 |

Decay (in-sample minus out-of-sample Sharpe): **0.36**. Overfitting meter: N = 22 trials, best train Sharpe 1.31, expected best under no skill 0.26, DSR 1.000, PSR(0) 1.000.

Walk-forward (17 folds, 374 trials): stitched out-of-sample return 2818.1%, Sharpe 1.06, max drawdown -29.2%, 104 trades; the selected pair changed 8 times.

### AAPL: price basis and risk-free rate (fixed SMA 20/50, full window of each set-up)

| Set-up | Series | Total return | CAGR | Sharpe (rf 0) | Sharpe (excess) | Max drawdown | Trades |
|---|---|---|---|---|---|---|---|
| A | SMA 20/50 | 38.9% | 6.3% | 0.42 | 0.25 | -27.0% | 18 |
| A | buy and hold | 188.4% | 21.6% | 0.82 | 0.71 | -33.3% | 1 |
| B | SMA 20/50 | 42.3% | 6.7% | 0.45 | 0.28 | -27.8% | 16 |
| B | buy and hold | 188.0% | 21.6% | 0.81 | 0.71 | -33.4% | 1 |
| C | SMA 20/50 | 3370.1% | 18.4% | 0.86 | 0.78 | -44.8% | 60 |
| C | buy and hold | 28307.5% | 30.9% | 1.00 | 0.94 | -60.9% | 1 |

Price return vs total return on the long window (SMA 20/50, buy and hold): split only: strategy 3343.9%, buy and hold 23755.2%; split + dividend: strategy 3370.1%, buy and hold 28307.5%. The engine's cash earns 0 and dividends are credited through adjusted prices, so the total-return figure counts them only while the strategy holds the stock.

### AAPL: regimes by calendar year (SMA 20/50, set-up C)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| 2005 | 252 | 62.7% | 62.8% | 3 |
| 2006 | 251 | 62.5% | 1.1% | 2 |
| 2007 | 251 | 83.3% | 83.7% | 4 |
| 2008 | 253 | 35.2% | -33.5% | 2 |
| 2009 | 252 | 83.7% | 86.7% | 2 |
| 2010 | 252 | 73.8% | 9.0% | 4 |
| 2011 | 252 | 65.1% | 12.9% | 3 |
| 2012 | 250 | 67.6% | 59.4% | 1 |
| 2013 | 252 | 49.6% | 11.9% | 3 |
| 2014 | 252 | 82.5% | 8.7% | 4 |
| 2015 | 252 | 51.2% | -10.1% | 3 |
| 2016 | 252 | 52.8% | 3.4% | 5 |
| 2017 | 251 | 81.3% | 25.3% | 2 |
| 2018 | 251 | 63.7% | 3.8% | 3 |
| 2019 | 252 | 78.6% | 53.7% | 2 |
| 2020 | 253 | 75.5% | 61.2% | 2 |
| 2021 | 252 | 67.9% | 7.7% | 3 |
| 2022 | 251 | 39.0% | -22.7% | 4 |
| 2023 | 250 | 65.6% | 19.4% | 2 |
| 2024 | 252 | 63.5% | 24.0% | 3 |
| 2025 | 250 | 60.4% | 5.0% | 3 |

Product of group growth factors 34.700510 = total growth 34.700510. Calendar-year attribution.

### AAPL: regimes by VIX bucket (previous close; low < 15, medium 15 to 25, high >= 25) (SMA 20/50, set-up C)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| low | 1986 | 73.2% | 600.6% | 23 |
| medium | 2429 | 63.4% | 88.5% | 31 |
| high | 868 | 50.7% | 162.7% | 6 |

Product of group growth factors 34.700510 = total growth 34.700510. VIX buckets are fixed in advance (low < 15, medium 15 to 25, high >= 25) and use the previous trading day's VIXCLS close; 'unknown' = no earlier observation. This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.

## Universe scan and the best-of-N control (SMA 20/50)

| Set-up | Symbols (N) | Sharpe p5 / p50 / p95 | Best Sharpe (symbol) | Best-of-N control: percentile of real best among simulated maxima | Simulated maxima p5 / p50 / p95 |
|---|---|---|---|---|---|
| A: Alpaca IEX, split, 5.4 years | 53 | -0.29 / 0.30 / 1.01 | 1.08 (AVGO) | 0.0% | 1.35 / 1.59 / 2.05 |
| B: Tiingo, split, same 5.4 years | 53 | -0.29 / 0.29 / 1.02 | 1.50 (GE) | 31.0% | 1.33 / 1.65 / 2.08 |
| C: Tiingo, split + dividend, 21 years | 48 | 0.03 / 0.44 / 0.82 | 0.88 (NVDA) | 6.0% | 0.88 / 1.01 / 1.21 |

Caveat: The universe is the current-day symbol list (survivors only), prices are the free IEX feed, and the window is short; symbols are correlated, so the effective number of independent symbols is below N. Nothing here estimates how the rule would have done on the whole market.

Timing (informational, this machine): set-up A 24 s, set-up B 30 s, set-up C 79 s.

## Same question, two windows

Each row is one question asked in all three set-ups; "N" is the number of trials behind any best number.

| Question | A: alpaca, split, 5.4 y | B: tiingo, split, 5.4 y | C: tiingo, split_dividend, 21.0 y |
|---|---|---|---|
| SPY: selected pair (N = 22 trials) | 3/20 | 3/20 | 10/150 |
| SPY: in-sample / out-of-sample Sharpe | 0.94 / 0.05 | 0.93 / 0.07 | 0.76 / 0.78 |
| SPY: out-of-sample trades | 4 | 4 | 8 |
| SPY: holdout Sharpe (trades) | 1.43 (7) | 1.44 (7) | 0.57 (8) |
| SPY: DSR of the best (N trials) | 0.907 (N = 22) | 0.910 (N = 22) | 0.928 (N = 22) |
| SPY: walk-forward stitched Sharpe (trades) | 0.72 (20) | 0.64 (20) | 0.88 (65) |
| SPY: 20/50 Sharpe rf 0 / excess | 0.48 / 0.21 | 0.51 / 0.24 | 0.57 / 0.42 |
| AAPL: selected pair (N = 22 trials) | 5/20 | 5/20 | 5/150 |
| AAPL: in-sample / out-of-sample Sharpe | 0.93 / 0.17 | 0.96 / 0.14 | 1.31 / 0.95 |
| AAPL: out-of-sample trades | 5 | 5 | 15 |
| AAPL: holdout Sharpe (trades) | -0.81 (7) | -0.80 (7) | 0.20 (12) |
| AAPL: DSR of the best (N trials) | 0.858 (N = 22) | 0.869 (N = 22) | 1.000 (N = 22) |
| AAPL: walk-forward stitched Sharpe (trades) | 0.86 (20) | 0.95 (17) | 1.06 (104) |
| AAPL: 20/50 Sharpe rf 0 / excess | 0.42 / 0.25 | 0.45 / 0.28 | 0.86 / 0.78 |
| Universe best Sharpe (N symbols) / percentile among simulated maxima | 1.08 (N = 53) / 0.0% | 1.50 (N = 53) / 31.0% | 0.88 (N = 48) / 6.0% |

### What changed and what did not

- **More evidence per block.** Out-of-sample blocks held 4 (SPY) and 5 (AAPL) trades on the 5.4-year window and hold 8 and 15 on the 21-year window; the walk-forward has 17 folds instead of 8. Still small counts: the numbers are less dominated by one episode, not proven.
- **In-sample to out-of-sample decay.** SPY: 0.89 (A) vs -0.02 (C); AAPL: 0.76 vs 0.36. The large Sprint 04 decay for SPY was measured on a four-trade test block and does not repeat on the long window; AAPL still loses Sharpe out of sample there. So the Sprint 04 lesson "the chosen pair looks worse out of sample" holds for AAPL and is not reproduced for SPY: it depends on the symbol and the block.
- **The search size did not shrink.** The same grid still has N = 22 trials. The deflated Sharpe of the best pair is 0.907 (A) vs 0.928 (C) for SPY and 0.858 vs 1.000 for AAPL: a longer sample makes the same Sharpe more significant, which says nothing about the future and nothing about the trials made elsewhere.
- **Source effect (A vs B, same dates).** The two feeds give nearby but not identical results (for example SPY 20/50 Sharpe 0.48 vs 0.51); the differences are consistent with IEX-only prints vs consolidated prices and with three sessions missing from the Alpaca series (see the reconciliation report); this page does not separate the two.
- **Best symbol differs between A and B.** GE has Sharpe 1.50 on Tiingo and 1.01 on Alpaca for the same rule and dates (best of A: AVGO 1.08). Tiingo codes some spin-offs as small splits, which the `split` basis turns into price adjustments that Alpaca's raw series does not have (for example GE has two such Tiingo-only events; pending note 05_P02), so part of such gaps is a modelling choice about distributions, not feed quality.
- **Risk-free effect.** Excess Sharpe is lower than the plain Sharpe on the long window (SPY 0.42 vs 0.57) and by a larger gap on the short window (0.21 vs 0.48), because 2022 to 2025 yields were far above zero. Idle cash earns 0 in the engine, so the excess figure of an in-and-out rule is biased downward.
- **Best of N symbols.** The best Sharpe among the scanned symbols is 1.08 (N = 53, A) and 0.88 (N = 48, C). In A the real best was at percentile 0.0% of the simulated best-of-N maxima, i.e. below all of them; in C it is at 6.0%, inside their range. The control keeps each symbol's historical drift, which makes it a strong benchmark; on 5.4 years the real best fell below every simulated maximum, on 21 years it does not. That says the best symbol is not remarkable relative to the control, which is a much weaker statement than skill.
- **The rule vs buy and hold.** SMA 20/50 total return stays below buy and hold in every set-up for both symbols; on the long window its max drawdown is smaller (SPY -28.3% vs -55.2%) while its Sharpe is below buy and hold (0.57 vs 0.63). That trade-off is window-dependent (the long window contains 2008).
- **Unchanged.** The universe is still a list of names that are large and liquid today (survivorship bias grows with history), costs are flat basis points, and nothing here is a forecast or advice.
