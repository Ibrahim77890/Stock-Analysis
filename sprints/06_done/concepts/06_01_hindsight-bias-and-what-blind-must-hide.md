# Hindsight bias, recognition and what "blind" must hide

**Sprint:** 06    **Used by tasks:** 06_02, 06_05, 06_07, 06_09, 06_12

## Why this matters for MarketLab
Blind replay (blueprint 23.2) only teaches something if the learner cannot recognise the chart. Sprint 02 hides identity in one response (`blind_view`), but the replay session endpoint still echoes the symbol and start date, and raw volume or a split artefact would identify a stock in seconds. If the learner recognises March 2020, their "prediction" is memory, and the score measures nothing.

## Plain-language explanation
**Hindsight bias** is the tendency to see past events as more predictable than they were: once you know the market fell, the signs look obvious. A blind episode removes the knowledge that causes it: you see only the bars up to the cursor and nothing that says which stock or year it is.

**Side channels** are things that identify the episode without naming it. Example: the first close is 214.37 and volume is 98 million shares: that is probably a famous stock in a known year. MarketLab therefore hides, and tests for the absence of: the symbol and name; any real date or year; the absolute price level (rebase so the first visible close is exactly 100); the absolute volume level (show volume relative to the mean of the first visible bars); adjustment factors and split dates; the number of bars to the end of the data. Recognition from the *shape* alone (a 30% crash in 20 days) cannot be removed, so the product also mixes in **synthetic random-walk episodes** that nobody can have memorised, and reveals which was which afterwards.

Example: a real episode shows bars `day 1..60` with close starting at 100.0 and relative volume around 1.0. The same code path serves a seeded random walk with the same volatility; the learner is not told which one it is until the reveal.

## Key terms
- hindsight bias: believing past outcomes were predictable after knowing them.
- blind episode: a replay whose identity (symbol, dates, level) is hidden until the reveal.
- side channel: any field or behaviour that leaks identity indirectly.
- rebasing: scaling prices so the first visible close equals 100 (returns unchanged).
- relative volume: volume divided by the mean volume of the first visible bars.
- reveal: the one-way step that ends the episode and shows identity and lineage.

## Common mistakes / pitfalls
- Hiding the symbol in the bars response but returning it from the "create session" response.
- Rebasing with the current close instead of the fixed first visible close (the chart would rescale as time passes and could leak the future).
- Showing absolute volume, split-adjusted volume jumps, or `factor`/`as_of` columns.
- Treating blindness as security: this is presentation for learning, not protection against a determined user with browser tools. Say so.

## What to implement in this domain
- Episode responses that never contain symbol, name, sector, real dates, absolute price or absolute volume until the reveal.
- A fixed rebasing scale and fixed volume scale computed once from the bars visible at episode start.
- A leak scan test that serialises every blind response of many seeded episodes and searches for identity strings, ISO dates in the episode range, and absolute levels.
- A mix of real and synthetic episodes with the kind hidden until the reveal.

## How to check you understood
1. Why must the rebase scale be fixed at episode start? (A scale that changes with the cursor would re-draw old bars and would depend on later data.)
2. Name three side channels other than the symbol. (Absolute price, absolute volume, real dates or weekdays/holidays pattern, split factors.)
3. Why add synthetic episodes? (Real ones can be recognised from memory; synthetic ones cannot, and they show how much "skill" appears on pure noise.)

## References
- [Wikipedia: Hindsight bias](https://en.wikipedia.org/wiki/Hindsight_bias): definition and the original studies (page read 2026-11-09).
- Fischhoff (1975), "Hindsight is not foresight", Journal of Experimental Psychology: Human Perception and Performance 1(3), 288-299, DOI 10.1037/0096-1523.1.3.288 (unverified): the classic experiment.
- MarketLab blueprint sections 23.2 (blind replay) and 23.3 item 7 (volume semantics differ by feed).
