# ADR 0011: Luck control by block bootstrap and a random-walk control

Status: accepted (Sprint 03)

## Context
One backtest is one draw. MarketLab teaches distrust of results (blueprint 23.1), so each result should be placed among results the same rule achieves where no edge can exist.

## Decision
`luck.shuffle_test` reruns the same spec on N seeded synthetic paths built from the real bars: (1) block bootstrap of "bar relatives" (gap, high/open, low/open, close/open, volume; default block 20) which keeps drift and bar shape but destroys long-range order, (2) GBM with the real mean and sample std of log returns and independent gaps and extremes. The first bar is the real first bar; every path has the real length and passes the OHLC sanity rules. Randomness comes from `SeedSequence(seed).spawn(n)`, so a run is reproducible. Output: quantiles, the real result's percentile rank and the fraction of paths at least as good, labelled a teaching aid, not a significance test.

## Alternatives
Stationary bootstrap or GARCH (better volatility clustering, more code); demeaned control (removes drift; deferred); a formal multiple-testing correction such as the deflated Sharpe ratio (next validation sprint).

## Consequences
The bootstrap keeps strong drift, so a rule that is simply long in a rising market can look good on it; the documentation says so. A pre-registered no-edge test (random-walk 'real' data, 20 seeds, rank inside [0.025, 0.975] in at least 16) guards the implementation.
