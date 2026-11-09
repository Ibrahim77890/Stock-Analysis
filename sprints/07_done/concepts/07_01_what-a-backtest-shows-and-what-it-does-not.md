# What a backtest shows, and what it does not

**Sprint:** 07    **Used by tasks:** 07_02, 07_05, 07_06

## Why this matters for MarketLab
A beginner who sees a rising line labelled "your strategy" will believe it. The Strategy Lab must show the same line next to the boring alternative (buy and hold), after costs, and say in plain words that it describes the past. This is the product principle (teach distrust) applied to the most tempting chart in finance.

## Plain-language explanation
A **backtest** replays a rule on past prices as if you had followed it, and records the **equity curve**: what 100 would have grown to. Our rule is a **moving-average crossover**: hold the stock when the short average of closing prices is above the long one, otherwise hold cash. A **simple moving average** is the plain mean of the last `k` closes.

Three honest details: (1) the rule looks at today's close and trades at **tomorrow's open**, because you cannot trade at a price you used to decide; (2) every trade pays a **cost** (commission and slippage, in basis points: 1 bp is 0.01%); (3) the benchmark is **buy and hold**: buy on day one and do nothing. A rule that cannot beat doing nothing, after costs, has no reason to exist.

Example: the stock goes from 100 to 150 in the window. Buy and hold ends at 150. A rule that was in cash for half the rise and avoided one fall may end at 140, or 170. Either way you learn what happened **to this stock in this window**, not what will happen.

## Key terms
- backtest: replaying a rule on historical data.
- equity curve: the value over time of 100 invested by the rule ("growth of 100").
- buy and hold: the benchmark that buys at the start and never sells.
- simple moving average: the plain mean of the last `k` closes.
- fill at next open: deciding at today's close and trading at tomorrow's open.
- basis point: 1/100 of one percent.
- trade count: how many times the rule bought; few trades mean little evidence.

## Common mistakes / pitfalls
- Comparing the rule with zero instead of with buy and hold.
- Ignoring costs, or using the same day's close to decide and to trade (look-ahead).
- Reading a result from 5 trades as if it were 500.
- Forgetting that the stock list is today's survivors.
- Believing "it worked" means "it will work".

## What to implement in this domain
- Reuse the Sprint 03 engine unchanged (next-open fills, costs, accounting identity); do not add a second engine.
- Always return the strategy and the buy-and-hold curve together, with the number of trades and a warning when trades are few.
- Present every number with one plain sentence and the words "in this sample".

## How to check you understood
1. Why trade at tomorrow's open? (The decision used today's close; trading at it would use information you did not have yet.)
2. A rule ends at 140 and buy and hold at 150. Which did better? (Buy and hold, by 10 points; the rule needed to beat 150.)
3. Why do few trades weaken a result? (Each trade is one piece of evidence; with 5 pieces, one lucky trade changes the picture.)

## References
- [Wikipedia: Backtesting](https://en.wikipedia.org/wiki/Backtesting): definition and the warning that past success may not carry over (read 2026-11-09).
- [Wikipedia: Buy and hold](https://en.wikipedia.org/wiki/Buy_and_hold): the benchmark strategy (read 2026-11-09).
- [Wikipedia: Moving average](https://en.wikipedia.org/wiki/Moving_average): simple moving average definition (read 2026-11-09).
- [Wikipedia: Slippage (finance)](https://en.wikipedia.org/wiki/Slippage_(finance)): why executed prices differ from expected ones (read earlier, Sprint 03).
- MarketLab `docs/02-domain/backtest.md` and ADR 0009: the engine's exact rules.
