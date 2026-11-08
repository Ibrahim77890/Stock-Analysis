# Backtest mechanics and fill timing

**Sprint:** 03    **Used by tasks:** 03_01, 03_02, 03_04

## Why this matters for MarketLab
A backtest replays history through a rule and records what would have happened. The most common silent error is **look-ahead in execution**: deciding with today's close and also trading at today's close. That trade was not possible, because the close is only known once the session is over. MarketLab's thesis is to teach distrust of results, so the engine must make the correct timing the default and show the wrong one beside it.

## Plain-language explanation
A daily bar gives four prices. A rule that reads the **close** of day t can only act **after** day t. The earliest realistic fill is the **open of day t+1** (a market order placed after the close, filled at the next open).

Example: the 20-day average crosses above the 50-day average at the close of Monday (close 100). Realistic: buy at Tuesday's open, say 101. Leaky: buy at Monday's close, 100. If prices gap up overnight a lot, the leaky version is systematically cheaper and the result is inflated, although no code "looks" wrong.

Other mechanics the engine must state explicitly: starting cash, long-only or not, fractional shares or not, what happens to the last signal (no next bar, so no fill), and what is assumed when a bar touches both a stop and a target (daily bars hide the intrabar path; this sprint has no stops).

## Key terms
- signal: the rule's decision at the close of day t (target position 0 or 1).
- fill: the executed trade; its price and date are separate from the signal's.
- fill model: the documented rule mapping signal to fill (here: `next_open`; teaching mode: `same_close`).
- mark-to-market: valuing the open position at each close to build the equity curve.
- equity curve: cash plus position value per day.
- long-only: no short selling, no leverage.

## Common mistakes / pitfalls
- Filling at the signal bar's close (look-ahead in execution).
- Using the signal bar's high or low to decide a fill price.
- Evaluating the equity curve with prices adjusted using future corporate actions (see Sprint 02 as-of adjustment).
- Counting a position as held on the signal day when it only starts at the next open.
- Forgetting that the final signal has no fill.

## What to implement in this domain
- A documented fill model `next_open` as default and a flagged `same_close` mode that is labelled "not realisable".
- A single place where "which price is used for which event" is written down (an ADR) and tested with a hand-computed golden case.
- Equity marked at the close each day; position effective from the fill bar onward.
- Where the project owner keeps backtest code: suggest `services/market-data/src/market_data/backtest.py`; record the choice in the status log.

## How to check you understood
1. A signal appears at the close of day 5. On which day and price does a `next_open` trade fill? (Day 6, the open of day 6.)
2. Prices are flat at 100, then a +5% gap up occurs at day 6 open. Which fill model reports the higher profit for a buy signalled on day 5, and why? (`same_close`: it buys at 100 and gets the gap for free.)
3. Why does the last day's signal never produce a trade? (There is no next bar to fill on.)

## References
- [Investor.gov: Understanding order types](https://www.investor.gov/introduction-investing/investing-basics/glossary/market-order) (unverified deep link): fact: what a market order means (fills at the best available price when it reaches the market).
- [Wikipedia: Slippage (finance)](https://en.wikipedia.org/wiki/Slippage_(finance)): why executed prices differ from expected prices.
- [Wikipedia: Look-ahead bias](https://en.wikipedia.org/wiki/Look-ahead_bias) (unverified): definition used by the glossary.
- [Polars user guide](https://docs.pola.rs/): expressions and `shift`, the tool used to move a signal to the next bar.
