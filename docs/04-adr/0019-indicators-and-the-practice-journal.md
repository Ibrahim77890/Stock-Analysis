# ADR 0019: Indicators and the practice journal

Status: accepted (Sprint 09)

## Context
The blueprint's MVP asks that a learner can inspect a basic indicator and record a simulated trading decision. The product already has a replay boundary (a learner sees days 1 to t only), a hidden identity for open episodes, and a rule that nothing scores a person.

## Decisions
1. **Indicators are computed in Python, causally, on the days already visible.** `market_data/indicators` holds `sma`, `ema` and `rsi` (Wilder smoothing) as plain functions with documented formulas. A truncation test proves the value on day t does not change when the series continues. `GET /episodes/{id}/indicators` returns only days 1..cursor and numbers, never dates or symbols. The gateway whitelists the reply.
2. **The EMA starts from the mean of the first n closes.** The Sprint 03 EMA starts from the first close; the two converge and a test shows it. Both are documented.
3. **A practice decision is a stance (long or flat) with a reason, taken at the server's cursor day.** The client cannot choose the day. `research.paper_decision` is append-only, enforced by a database trigger that refuses UPDATE and DELETE. One decision per day; a client key makes a double click store one row. One SQL statement (`INSERT ... ON CONFLICT DO NOTHING`) decides, so simultaneous identical requests cannot fail or duplicate (a race found by the real-stack test, fixed).
4. **Results are recomputed from the stored rows on every read** and use only days up to the cursor. A decision's result is `None` until a later day exists. Totals are the product of the per-decision factors, so they reconcile with the rows by construction and by test.
5. **No score, rank, win rate or grade.** The journal shows each decision, the learner's own reason, the result in words, and a count line that says a few decisions say very little. Look-back questions appear after the reveal.
6. **Limits:** 30 decisions a minute per learner in the durable limiter; 250 decisions per episode; reason 1 to 280 characters; cost 0 to 50 basis points.

## Rejected
- **Computing indicators in the browser or the gateway:** two implementations of the same numbers would drift; the rule "Python computes everything" stays.
- **Editable or deletable decisions:** they would let a learner rewrite the past, which defeats the journal.
- **A win-rate badge or a profit curve:** it would invite reading luck as skill from a handful of decisions.
- **Letting the client send the day:** it could be used to mark a decision against days not yet revealed.
- **More indicators (MACD, Bollinger) now:** three are enough to teach the idea; each extra one is one more thing to test for causality.

## Consequences
- A decision needs one extra database round trip beyond the episode read.
- Results are recomputed on each read (the episode has at most 500 days and 250 decisions, so this is cheap, see benchmark 06).
- The journal records and explains decisions. It does not measure skill, and no one has measured whether it helps people learn.
