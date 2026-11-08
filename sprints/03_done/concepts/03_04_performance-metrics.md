# Performance metrics: return, CAGR, volatility, Sharpe, drawdown

**Sprint:** 03    **Used by tasks:** 03_03, 03_06, 03_07

## Why this matters for MarketLab
Metrics turn an equity curve into a few numbers learners will compare. Each has conventions (252 days, risk-free rate, ddof) that change the value; if they are hidden, two correct programs disagree. The engine must state them and prove them with hand-computed cases.

## Plain-language explanation
Given daily equity E_0..E_n:
- **Total return** = E_n / E_0 - 1.
- **CAGR** = (E_n / E_0)^(252 / n) - 1, where n is the number of daily returns (convention: 252 sessions per year).
- **Daily returns** r_t = E_t / E_(t-1) - 1; **annualised volatility** = sample std (ddof 1) of r times sqrt(252).
- **Sharpe ratio** (this project: risk-free rate = 0, stated) = mean(r) / std(r) * sqrt(252). Adding a real risk-free rate (FRED) is deferred.
- **Maximum drawdown** = the most negative value of E_t / max(E_0..E_t) - 1.
- **Exposure** = fraction of days with a position; **win rate** = winning trades / trades.

Example: equity 100, 110, 99, 120. Peak after day 1 is 110; drawdown on day 2 = 99/110 - 1 = -10%; total return = +20%; max drawdown = -10%.

## Key terms
- drawdown: decline from the running peak.
- annualise: scale a daily statistic to a year (mean by 252, std by sqrt(252)).
- benchmark: here, buy-and-hold of the same asset over the same bars, with the same costs for its single entry.
- risk-free rate: return of a safe asset; set to 0 here and documented.

## Common mistakes / pitfalls
- Using population std instead of sample std without saying so.
- Annualising with 365 instead of 252 for daily trading bars.
- Computing max drawdown on returns instead of on the equity peak.
- Reporting Sharpe for a curve with no variation (division by zero): return null, not infinity.
- Reading a high Sharpe from a short sample as evidence (it has a wide error bar).

## What to implement in this domain
- Pure functions in a `metrics` module taking an equity series (and trade list for trade metrics); zero-variance and too-short inputs return null with a reason, never raise a division error.
- Every convention listed above written in the data dictionary / docs page.
- Buy-and-hold benchmark computed through the same engine path (same fill model), so differences are strategy, not plumbing.

## How to check you understood
1. Equity 100, 110, 99, 120: max drawdown? (-10%.)
2. Daily returns have mean 0.001 and std 0.01. Annualised Sharpe? (0.1 * sqrt(252) = about 1.59.)
3. Why can two tools report different Sharpe for the same curve? (Different annualisation, ddof, or risk-free rate.)

## References
- [Sharpe, The Sharpe Ratio (1994)](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm): the author's definition (verified reachable).
- [Wikipedia: Sharpe ratio](https://en.wikipedia.org/wiki/Sharpe_ratio): formulas and caveats (verified reachable).
- [Wikipedia: Drawdown (economics)](https://en.wikipedia.org/wiki/Drawdown_(economics)): definition (verified reachable).
- [Wikipedia: Compound annual growth rate](https://en.wikipedia.org/wiki/Compound_annual_growth_rate): formula (verified reachable).
