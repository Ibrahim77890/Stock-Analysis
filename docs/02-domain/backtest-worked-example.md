# Backtest worked example (generated 2026-11-08 13:42 UTC)

Produced by `scripts/backtest_worked_example.py` on this machine from the loaded data; every number below is copied from that run. It demonstrates mechanics and caveats. **It is not evidence of a profitable strategy.**

Environment: Windows-11-10.0.26300-SP0, Python 3.14.10. Engine version 1. Prices are split-adjusted as of the last date; dividends are not included in returns; risk-free rate 0; universe is survivorship-biased (see ADR 0009 and the data dictionary).

## AAPL (SMA 20/50, 1366 bars, 2020-07-27 to 2025-12-31)

| Setting | Strategy return | CAGR | Sharpe | Max drawdown | Trades | Exposure | Buy-and-hold return | B&H Sharpe | B&H max drawdown |
|---|---|---|---|---|---|---|---|---|---|
| zero cost | 40.3% | 6.5% | 0.43 | -26.8% | 18 | 56.6% | 188.5% | 0.82 | -33.3% |
| 5 bps slippage, 1 bp commission | 37.4% | 6.0% | 0.41 | -27.2% | 18 | 56.6% | 188.3% | 0.82 | -33.3% |

**Look-ahead detector** (same strategy, zero cost):

| Fill model | Realisable | Total return | Sharpe |
|---|---|---|---|
| next_open | yes | 40.3% | 0.43 |
| same_close | **no** | 34.5% | 0.39 |

Difference (same_close - next_open): -5.9%. Whatever its sign here, the same_close number is not obtainable in practice.

**Cost sweep, SMA 20/50** (slippage bps per fill):

| Cost (bps) | Strategy return | Trades | Total costs | Buy-and-hold return |
|---|---|---|---|---|
| 0 | 40.3% | 18 | 0 | 188.5% |
| 1 | 39.8% | 18 | 376 | 188.5% |
| 2 | 39.4% | 18 | 751 | 188.4% |
| 5 | 37.9% | 18 | 1868 | 188.3% |
| 10 | 35.5% | 18 | 3703 | 188.2% |
| 20 | 30.9% | 18 | 7274 | 187.9% |
| 50 | 17.8% | 18 | 17241 | 187.1% |

Break-even vs 0%: None bps; vs buy-and-hold: 0.0 bps (`None` = still above at 50 bps; `0.0` = not above even at 0 bps).

**Cost sweep, SMA 2/3** (slippage bps per fill):

| Cost (bps) | Strategy return | Trades | Total costs | Buy-and-hold return |
|---|---|---|---|---|
| 0 | 30.8% | 241 | 0 | 188.5% |
| 1 | 24.6% | 241 | 4379 | 188.5% |
| 2 | 18.8% | 241 | 8551 | 188.4% |
| 5 | 2.8% | 241 | 19915 | 188.3% |
| 10 | -19.2% | 241 | 35544 | 188.2% |
| 20 | -50.0% | 241 | 57500 | 187.9% |
| 50 | -88.2% | 241 | 85358 | 187.1% |

Break-even vs 0%: 5.639367803782527 bps; vs buy-and-hold: 0.0 bps (`None` = still above at 50 bps; `0.0` = not above even at 0 bps).

**Luck control, block_bootstrap** (200 paths, seed 1, 1.7 s): real total return 40.3% is at percentile 42.0% of the paths; 58.0% of paths did at least as well. Path return quantiles p5/p50/p95: -27.9% / 57.9% / 266.1%. Real Sharpe 0.43; fraction of paths with Sharpe >= real: 55.5%.

**Luck control, gbm** (200 paths, seed 1, 1.7 s): real total return 40.3% is at percentile 37.0% of the paths; 63.0% of paths did at least as well. Path return quantiles p5/p50/p95: -21.2% / 68.6% / 323.7%. Real Sharpe 0.43; fraction of paths with Sharpe >= real: 59.5%.

Timing (informational, this machine): one run 2 ms, 100 runs 0.3 s on 1366 bars.

Saved run (`research.backtest_run`): run_id 1, config_hash `782fe34644ac0bb11e100a12fc3eaf734aebf55735f0e35a04e47984e91be32d`, result_hash `8d9ba4412272a20b1cc2eeea98c5e199b2879c64cb07456b23e89ffa6f7d35ae`, dataset_fingerprint `237c68498d44139f8568fe605fae366f93f130e42d080fa54602b09e8e9db4c3`; reproduce status: **reproduced**.

## SPY (SMA 20/50, 1367 bars, 2018-11-01 to 2025-12-31)

| Setting | Strategy return | CAGR | Sharpe | Max drawdown | Trades | Exposure | Buy-and-hold return | B&H Sharpe | B&H max drawdown |
|---|---|---|---|---|---|---|---|---|---|
| zero cost | 31.1% | 5.1% | 0.49 | -29.5% | 12 | 68.5% | 112.0% | 0.90 | -25.4% |
| 5 bps slippage, 1 bp commission | 29.3% | 4.9% | 0.47 | -30.0% | 12 | 68.5% | 111.9% | 0.90 | -25.4% |

**Look-ahead detector** (same strategy, zero cost):

| Fill model | Realisable | Total return | Sharpe |
|---|---|---|---|
| next_open | yes | 31.1% | 0.49 |
| same_close | **no** | 28.4% | 0.46 |

Difference (same_close - next_open): -2.7%. Whatever its sign here, the same_close number is not obtainable in practice.

**Cost sweep, SMA 20/50** (slippage bps per fill):

| Cost (bps) | Strategy return | Trades | Total costs | Buy-and-hold return |
|---|---|---|---|---|
| 0 | 31.1% | 12 | 0 | 112.0% |
| 1 | 30.8% | 12 | 253 | 112.0% |
| 2 | 30.5% | 12 | 506 | 111.9% |
| 5 | 29.6% | 12 | 1260 | 111.9% |
| 10 | 28.1% | 12 | 2506 | 111.8% |
| 20 | 25.2% | 12 | 4955 | 111.6% |
| 50 | 16.9% | 12 | 11971 | 110.9% |

Break-even vs 0%: None bps; vs buy-and-hold: 0.0 bps (`None` = still above at 50 bps; `0.0` = not above even at 0 bps).

**Cost sweep, SMA 2/3** (slippage bps per fill):

| Cost (bps) | Strategy return | Trades | Total costs | Buy-and-hold return |
|---|---|---|---|---|
| 0 | 16.2% | 248 | 0 | 112.0% |
| 1 | 10.6% | 248 | 4957 | 112.0% |
| 2 | 5.2% | 248 | 9674 | 111.9% |
| 5 | -9.3% | 248 | 22507 | 111.9% |
| 10 | -29.2% | 248 | 40101 | 111.8% |
| 20 | -56.9% | 248 | 64670 | 111.6% |
| 50 | -90.3% | 248 | 95273 | 110.9% |

Break-even vs 0%: 3.08017619533509 bps; vs buy-and-hold: 0.0 bps (`None` = still above at 50 bps; `0.0` = not above even at 0 bps).

**Luck control, block_bootstrap** (200 paths, seed 1, 1.7 s): real total return 31.1% is at percentile 29.0% of the paths; 71.0% of paths did at least as well. Path return quantiles p5/p50/p95: -2.6% / 50.1% / 150.8%. Real Sharpe 0.49; fraction of paths with Sharpe >= real: 66.0%.

**Luck control, gbm** (200 paths, seed 1, 2.0 s): real total return 31.1% is at percentile 23.0% of the paths; 77.0% of paths did at least as well. Path return quantiles p5/p50/p95: 1.7% / 60.2% / 223.4%. Real Sharpe 0.49; fraction of paths with Sharpe >= real: 70.0%.

Timing (informational, this machine): one run 3 ms, 100 runs 0.3 s on 1367 bars.

Saved run (`research.backtest_run`): run_id 2, config_hash `15e2afd147e37809cb50cb1319edc942c30a72445757b9d359177a684731b210`, result_hash `6145c9b7c3156ed7ba075ae59faafcbdf7ef405c397ea0522c7aa7800b15179c`, dataset_fingerprint `4b2a2f824689a8c32493761e473ef254358ef56510ef4f7475937d48bb7a4e30`; reproduce status: **reproduced**.
