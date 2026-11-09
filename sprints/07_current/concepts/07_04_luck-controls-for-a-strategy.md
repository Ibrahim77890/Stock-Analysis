# Luck controls for a strategy: shuffled and random charts

**Sprint:** 07    **Used by tasks:** 07_02, 07_06

## Why this matters for MarketLab
"It made 60%" means nothing until you know what the same rule does on charts that contain no pattern. If random charts give similar results, the rule found noise. MarketLab has this tool since Sprint 03 (the shuffle test); the lab must show it in one sentence a beginner can read, and be honest about what it controls for.

## Plain-language explanation
A **luck control** runs the same rule on many **made-up charts** that keep some features of the real one but destroy any pattern in time. Two kinds exist in the engine: **block bootstrap** (cut the real daily returns into blocks and glue random blocks together: it keeps the size and some clustering of moves but not their order) and a **random walk** (daily returns drawn from a bell curve with the same average and spread).

You get a distribution of results: "on 100 made-up charts the rule's total return was above 50% on 4 of them". Where the real result falls in that crowd is its **percentile**. If it sits in the middle, the rule did what chance does. If it sits at the top (above 95% of the made-up charts), chance is a poor explanation, but see the limits.

**Limits.** The control keeps the real chart's average drift, so a stock that rose a lot makes every made-up chart rise too; a rule that is simply "stay invested" looks good against it. Blocks keep short-range structure but not long-range. And the control only addresses luck, not overfitting: if you tried 30 ideas, even a top percentile needs the tries count beside it.

## Key terms
- luck control / shuffle test: running the rule on made-up charts with no time pattern.
- block bootstrap: resampling blocks of real returns.
- random walk: made-up returns with no memory.
- percentile: the share of made-up results at or below the real one.
- drift: the average daily return.
- drawdown: the largest fall from a previous peak (a measure of how bad the worst stretch was).

## Common mistakes / pitfalls
- Reading a percentile as a probability that the rule works.
- Running too few made-up charts (100 is a floor, not luxury) or not fixing the seed (results change each time).
- Using the control to "prove" a rule while ignoring the number of tries.
- Explaining percentile in jargon.

## What to implement in this domain
- Reuse the Sprint 03 shuffle test with a fixed seed and a capped number of paths (default 100, maximum 200) so a run stays within a time budget.
- Show: real total return, the median and the 5th to 95th range of made-up results, the percentile, and one sentence with "in this sample".
- Show drawdown and trade count beside the return so a high return with a huge fall is visible.

## How to check you understood
1. Why keep the seed fixed? (So the same run gives the same answer; otherwise the percentile changes between clicks and invites cherry-picking.)
2. The real result is at the 60th percentile. What does it say? (Chance alone does this often; nothing special.)
3. Why is a top percentile still not enough? (Many tries, a drift-keeping control and a short window can all produce one.)

## References
- [Wikipedia: Bootstrapping (statistics)](https://en.wikipedia.org/wiki/Bootstrapping_(statistics)): resampling idea (read earlier, Sprint 03).
- [Wikipedia: Geometric Brownian motion](https://en.wikipedia.org/wiki/Geometric_Brownian_motion): the random-walk model (read earlier, Sprint 03).
- [Wikipedia: Maximum drawdown](https://en.wikipedia.org/wiki/Maximum_drawdown): definition (read 2026-11-09).
- [NumPy: random Generator](https://numpy.org/doc/stable/reference/random/generator.html): seeded random numbers (read earlier, Sprint 03).
- MarketLab ADR 0011 and `docs/02-domain/backtest.md` (luck control section).
