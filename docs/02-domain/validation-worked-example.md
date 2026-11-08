# Validation worked example (generated 2026-11-08 14:14 UTC)

Produced by `scripts/validation_worked_example.py` from the loaded data; every number is copied from that run. It shows mechanics and caveats and is **not evidence of a profitable strategy**. Sharpe values are annualised; costs are 1 bp commission + 2 bps slippage per fill; prices are split-adjusted; dividends are not in returns; the universe is survivorship-biased. Environment: Windows-11-10.0.26300-SP0, Python 3.14.10. Grid: fast in 3, 5, 10, 20, 30 and slow in 20, 30, 50, 100, 150 with fast < slow = 22 pairs.

## SPY (1366 bars, 2020-07-27 to 2025-12-31)

### Train/test split (train 1,000 bars, embargo 5, holdout 200 bars) - 22 trials

Selected on the training bars only: **3/20**.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample (train) | 2020-07-27 to 2024-07-17 | 48.1% | 0.94 | 29 |
| Out-of-sample (test) | 2024-07-25 to 2025-03-10 | 0.0% | 0.05 | 4 |

Decay (in-sample minus out-of-sample Sharpe): **0.89**. Only 4 test trades: noisy.

Holdout (one use, last 200 bars, 2025-03-18 to 2025-12-31): return 12.0%, Sharpe 1.43, trades 7. A second call is refused (HTTP 409 in Swagger).

**Overfitting meter** for this search:

| Trials N | Best train Sharpe | Expected best under no skill | DSR of the best | PSR(0) of the best |
|---|---|---|---|---|
| 22 | 0.94 | 0.31 | 0.907 | 0.974 |

DSR is a warning light: trials are treated as independent and the registry cannot count ideas tried elsewhere.

### Walk-forward (train 500, test 100, embargo 5) - 8 folds, 176 trials

| Fold | Test range | Selected | IS Sharpe | OOS Sharpe | OOS return | OOS trades |
|---|---|---|---|---|---|---|
| 1 | 2022-07-28 to 2022-12-16 | 20/100 | 1.09 | -3.02 | -15.1% | 2 |
| 2 | 2022-12-19 to 2023-05-12 | 10/50 | 0.45 | -0.16 | -1.0% | 3 |
| 3 | 2023-05-15 to 2023-10-05 | 5/20 | 0.45 | 1.86 | 6.7% | 2 |
| 4 | 2023-10-06 to 2024-02-29 | 5/20 | 0.44 | 2.71 | 11.7% | 3 |
| 5 | 2024-03-01 to 2024-07-24 | 5/20 | 1.04 | 1.89 | 6.9% | 2 |
| 6 | 2024-07-25 to 2024-12-13 | 5/20 | 1.77 | 0.34 | 1.1% | 3 |
| 7 | 2024-12-16 to 2025-05-12 | 3/30 | 1.86 | 0.16 | 0.4% | 4 |
| 8 | 2025-05-13 to 2025-10-03 | 3/30 | 1.43 | 3.66 | 14.7% | 1 |

Stitched out-of-sample curve: return 24.6%, Sharpe 0.72, max drawdown -17.8%, 20 trades; the selected pair changed 3 times between folds.

### Regimes by calendar year (SMA 20/50)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| 2020 | 111 | 44.1% | 9.0% | 1 |
| 2021 | 252 | 91.7% | 18.9% | 1 |
| 2022 | 251 | 39.8% | -24.1% | 3 |
| 2023 | 250 | 60.4% | 8.3% | 3 |
| 2024 | 252 | 86.9% | 14.4% | 2 |
| 2025 | 250 | 74.8% | 6.9% | 2 |

Product of group growth factors 1.301972 = total growth 1.301972. Calendar-year attribution.

### Regimes by trailing volatility (SMA 20/50)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| warmup | 21 | 0.0% | 0.0% | 0 |
| low | 449 | 96.4% | 15.3% | 2 |
| medium | 448 | 75.2% | 12.5% | 5 |
| high | 448 | 37.3% | 0.4% | 5 |

Product of group growth factors 1.301972 = total growth 1.301972. Volatility terciles use thresholds from the full sample (descriptive, hindsight); each day's label uses only volatility known at the previous close.

## AAPL (1366 bars, 2020-07-27 to 2025-12-31)

### Train/test split (train 1,000 bars, embargo 5, holdout 200 bars) - 22 trials

Selected on the training bars only: **5/20**.

| Block | Range | Total return | Sharpe | Trades |
|---|---|---|---|---|
| In-sample (train) | 2020-07-27 to 2024-07-17 | 94.0% | 0.93 | 26 |
| Out-of-sample (test) | 2024-07-25 to 2025-03-10 | 0.9% | 0.17 | 5 |

Decay (in-sample minus out-of-sample Sharpe): **0.76**. Only 5 test trades: noisy.

Holdout (one use, last 200 bars, 2025-03-18 to 2025-12-31): return -13.4%, Sharpe -0.81, trades 7. A second call is refused (HTTP 409 in Swagger).

**Overfitting meter** for this search:

| Trials N | Best train Sharpe | Expected best under no skill | DSR of the best | PSR(0) of the best |
|---|---|---|---|---|
| 22 | 0.93 | 0.42 | 0.858 | 0.971 |

DSR is a warning light: trials are treated as independent and the registry cannot count ideas tried elsewhere.

### Walk-forward (train 500, test 100, embargo 5) - 8 folds, 176 trials

| Fold | Test range | Selected | IS Sharpe | OOS Sharpe | OOS return | OOS trades |
|---|---|---|---|---|---|---|
| 1 | 2022-07-28 to 2022-12-16 | 5/30 | 0.87 | -0.75 | -7.8% | 3 |
| 2 | 2022-12-19 to 2023-05-12 | 5/30 | 0.75 | 2.51 | 20.6% | 2 |
| 3 | 2023-05-15 to 2023-10-05 | 5/20 | 1.27 | 0.13 | 0.3% | 2 |
| 4 | 2023-10-06 to 2024-02-29 | 5/20 | 0.93 | 0.30 | 1.1% | 3 |
| 5 | 2024-03-01 to 2024-07-24 | 5/20 | 0.74 | 2.30 | 21.4% | 2 |
| 6 | 2024-07-25 to 2024-12-13 | 3/100 | 1.38 | 1.40 | 10.5% | 2 |
| 7 | 2024-12-16 to 2025-05-12 | 30/50 | 1.56 | -1.22 | -8.1% | 2 |
| 8 | 2025-05-13 to 2025-10-03 | 3/100 | 0.52 | 1.92 | 13.2% | 4 |

Stitched out-of-sample curve: return 57.4%, Sharpe 0.86, max drawdown -21.1%, 20 trades; the selected pair changed 4 times between folds.

### Regimes by calendar year (SMA 20/50)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| 2020 | 111 | 32.4% | 8.3% | 2 |
| 2021 | 252 | 67.9% | 7.3% | 3 |
| 2022 | 251 | 37.8% | -21.5% | 5 |
| 2023 | 250 | 65.6% | 18.9% | 2 |
| 2024 | 252 | 62.7% | 22.2% | 3 |
| 2025 | 250 | 59.6% | 4.7% | 3 |

Product of group growth factors 1.388741 = total growth 1.388741. Calendar-year attribution.

### Regimes by trailing volatility (SMA 20/50)

| Group | Days | Share in market | Return | Trades started |
|---|---|---|---|---|
| warmup | 21 | 0.0% | 0.0% | 0 |
| low | 449 | 70.6% | 23.0% | 6 |
| medium | 448 | 71.2% | 15.1% | 4 |
| high | 448 | 30.6% | -1.9% | 8 |

Product of group growth factors 1.388741 = total growth 1.388741. Volatility terciles use thresholds from the full sample (descriptive, hindsight); each day's label uses only volatility known at the previous close.

## Universe scan, SMA 20/50 on 53 symbols (0 skipped)

Sharpe quantiles p5/p25/p50/p75/p95: -0.29 / -0.01 / 0.30 / 0.50 / 1.01; best 1.08.

| Best 5 | Sharpe | Return | Trades |
|---|---|---|---|
| AVGO | 1.08 | 386.4% | 12 |
| LLY | 1.04 | 240.8% | 15 |
| META | 1.01 | 295.9% | 14 |
| GE | 1.01 | 247.8% | 15 |
| GS | 0.96 | 152.6% | 14 |

| Worst 5 | Sharpe | Return | Trades |
|---|---|---|---|
| PG | -0.28 | -19.4% | 19 |
| NKE | -0.28 | -34.0% | 15 |
| INTC | -0.31 | -60.8% | 18 |
| UPS | -0.48 | -45.6% | 16 |
| UNH | -0.51 | -48.4% | 16 |

**Best-of-53 control** (100 replicates of 53 random-walk symbols, seed 1): the real best Sharpe 1.08 is at percentile 0.0% of the simulated maxima (100.0% of replicates had a maximum at least as large; p5/p50/p95 of simulated maxima: 1.35 / 1.59 / 2.05).

Caveat: The universe is the current-day symbol list (survivors only), prices are the free IEX feed, and the window is short; symbols are correlated, so the effective number of independent symbols is below N. Nothing here estimates how the rule would have done on the whole market.

Timing (informational, this machine): scan 1.7 s, 100 replicates x 53 symbols 48.9 s.
