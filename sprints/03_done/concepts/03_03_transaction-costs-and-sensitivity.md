# Transaction costs, slippage and cost sensitivity

**Sprint:** 03    **Used by tasks:** 03_01, 03_02, 03_06

## Why this matters for MarketLab
Blueprint 26.2 lists "reporting backtest results without costs" as one of five ways to silently invalidate the project. A strategy that trades often can look profitable at zero cost and lose money at a realistic one. The cost sweep makes that visible instead of arguing it.

## Plain-language explanation
Two simple, documented cost components, both expressed in **basis points** (1 bp = 0.01%):
- **Commission:** a fee proportional to the trade value (many US retail brokers charge zero commission on stocks, but a non-zero value is a useful stress setting).
- **Slippage:** the fill is worse than the quoted reference price, because you cross the spread and move the price. Model: buy at `open * (1 + s)`, sell at `open * (1 - s)`.

Example: buy and sell 100,000 USD of stock with 5 bps slippage and 1 bp commission per fill. Round trip cost is about 2 * (5 + 1) = 12 bps = 120 USD. A strategy with 40 round trips a year pays about 4,800 USD (4.8% of capital) before any profit.

A **cost sensitivity sweep** reruns the same strategy over a grid of cost levels and plots return against cost. The **break-even cost** is the cost at which the strategy's return falls to zero (or to the buy-and-hold return).

## Key terms
- bp (basis point): 0.01%.
- spread: ask minus bid.
- slippage: fill price minus reference price, in the unfavourable direction.
- turnover: total traded value divided by average equity.
- break-even cost: smallest cost level at which the strategy no longer beats the chosen baseline.

## Common mistakes / pitfalls
- Applying costs only to buys or only to sells.
- Using costs as a fraction when the config says bps (factor 10,000).
- Concluding the strategy is "robust" from one cost level.
- Treating zero cost as the base case.
- Assuming a flat bps slippage is realistic for illiquid names or large orders (it is a simplification; deferred: size-dependent impact).

## What to implement in this domain
- `commission_bps` and `slippage_bps` in the backtest spec, each >= 0, applied to every fill.
- Trade records that store the cost paid, so total cost is reconcilable: `final equity = initial cash + sum(pnl) - ...` stated exactly in the ADR.
- `cost_sweep(spec, bars, grid)` returning one row per grid value, plus the break-even estimate (or null if never crossed).
- Where the project owner keeps it: same module family as the engine.

## How to check you understood
1. 10 bps slippage on a 100.00 buy: what is the fill price? (100.10.)
2. A strategy makes 6% gross over a year with 30 round trips at 12 bps per round trip. Net? (6% - 3.6% = about 2.4%, ignoring compounding.)
3. Why report the break-even cost instead of one net number? (It shows how fragile the result is to the assumption.)

## References
- [Investor.gov: Trading costs / commissions glossary](https://www.investor.gov/introduction-investing/investing-basics/glossary/trading-costs): fact: fees are real costs paid by the investor (verified reachable).
- [Wikipedia: Slippage (finance)](https://en.wikipedia.org/wiki/Slippage_(finance)): definition (verified reachable).
- [Wikipedia: Basis point](https://en.wikipedia.org/wiki/Basis_point) (unverified): unit definition.
