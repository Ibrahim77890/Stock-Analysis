# Moving-average crossover (mechanic) and what it does not prove (interpretation)

**Sprint:** 03    **Used by tasks:** 03_02, 03_04, 03_07

## Why this matters for MarketLab
The first strategy in the engine is deliberately the simplest popular one, because its definition is short enough to verify by hand. It is a **test vehicle for the engine**, not a recommendation. The sprint's lesson is how little a single backtest of such a rule tells you.

## Plain-language explanation
**Mechanic (fact).** A simple moving average SMA(n) is the mean of the last n closes, including today (Sprint 02, `indicators.sma`). A crossover rule holds the asset when the fast average (say n=20) is above the slow average (say n=50) and holds cash otherwise.

Example with fast=2, slow=3 on closes 10, 11, 12, 11, 9: SMA2 = (-, 10.5, 11.5, 11.5, 10); SMA3 = (-, -, 11, 11.33, 10.67). From day 3: fast 11.5 > slow 11 -> target 1; day 4: 11.5 > 11.33 -> 1; day 5: 10 < 10.67 -> 0. The strategy buys at the open of day 4 and sells at the open of day 6 (if it existed).

**Interpretation (debated).** Claims that crossovers "capture trends" are folklore until tested out of sample, with costs, against a luck control. In a random walk, crossover rules have no edge by construction but still produce random wins, which is why the shuffle test exists.

## Key terms
- fast / slow window: the two SMA lengths, fast < slow.
- warm-up: days before both averages exist; the target is 0 (no position) then.
- whipsaw: repeated crossovers in a sideways market; many small losing trades plus costs.
- parameter set: the (fast, slow) pair; every pair tried is another chance to get lucky (multiple testing).

## Common mistakes / pitfalls
- Using `rolling(center=True)` anywhere (look-ahead).
- Treating the first defined comparison as a signal when one average is still null.
- Reporting only the best of many (fast, slow) pairs.
- Comparing with raw prices across a split (a fake -75% day triggers a false crossover).

## What to implement in this domain
- `sma_crossover(df, fast, slow)` returns a 0/1 target per close; null averages give 0; requires `fast < slow`, both >= 1.
- Reuse `indicators.sma`; do not re-implement the average.
- Tests: the 5-bar example above, a series shorter than `slow` (never in the market), and a split case on real data.

## How to check you understood
1. Why is the target 0 during warm-up? (The slow average does not exist yet, so there is no valid comparison.)
2. Closes are constant. What does the rule do? (Fast equals slow, not strictly greater, so it stays in cash.)
3. Why is a good backtest of one (fast, slow) pair weak evidence? (It is one draw; with many tried pairs some win by chance.)

## References
- [Wikipedia: Moving average crossover](https://en.wikipedia.org/wiki/Moving_average_crossover): short definition (verified reachable).
- [Bailey and Lopez de Prado, The Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) (unverified: the site blocks automated checks): why many tried parameters inflate the best result.
- [Polars: rolling_mean](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.Expr.rolling_mean.html) (unverified): trailing window semantics.
