# Paper trading without future leakage: record the decision before the outcome

**Used by tasks:** 09_03, 09_04, 09_08

## What it is
Paper trading means recording a trade decision without real money and marking it to the market later. Done carelessly it lets the learner see the outcome and then "decide". Done honestly the decision is stored **before** the next bars are revealed, cannot be edited afterwards, and is marked using only bars the replay has reached.

## Why it matters here
Blueprint MVP item 7: "record a simulated trading decision". The product already has a replay boundary (the learner sees days 1 to t only). A decision made on day t is stored with day t, a stance (long or flat), the cost assumption and a written reason; its result is computed when later days are revealed.

## Key ideas
- Append-only records: a decision is never updated, only followed by a later one. This makes the journal a trustworthy record.
- Mark-to-market: a long stance earns the next day's change; costs (basis points) are charged on a change of stance.
- Replay boundary: the result of a decision may not be read for days the episode has not reached; an open episode's identity stays hidden until the reveal, like guesses.
- A stance is not advice and the product never scores the learner as skilled or unskilled.

## Common mistakes
Allowing edits or deletes; computing results from the full series; showing real symbols or dates in an unrevealed episode; ignoring costs.

## Check yourself
1. Why must a decision be immutable? 2. What may a result computed on day t use?

## References
- Paper trading: https://en.wikipedia.org/wiki/Paper_trading (verified reachable 2026-11-10)
- Hindsight bias: https://en.wikipedia.org/wiki/Hindsight_bias (verified reachable 2026-11-10)
