# Precommitment, append-only records and resolving outcomes without leaks

**Sprint:** 06    **Used by tasks:** 06_02, 06_03, 06_05, 06_12, 06_13

## Why this matters for MarketLab
A score is only believable if the learner could not edit a prediction after seeing the result. That needs a record that is written before the outcome exists, never changed, and resolved by data that arrived later. The same discipline protects the replay boundary: predicting at the cursor must not let any response contain a bar beyond the cursor.

## Plain-language explanation
**Precommitment** (the idea behind scientific preregistration) means committing to a claim before the evidence exists. Here a prediction is `(episode, cursor position, horizon h, probability p)`. It is accepted only for the **current** cursor and only if the resolving bar, `h` bars ahead, is still in the future of that cursor and inside the episode. Once stored, `p`, `h` and the cursor position can never change; only the outcome fields are filled in, once, when the cursor reaches the resolving bar. A database trigger enforces this so no code path can forget.

**Resolution.** When the cursor advances to position `c`, every unresolved prediction with `made_at + h <= c` is resolved from the stored bars: `y = 1` if `close[made_at + h] > close[made_at]`. Nothing later than `c` is read. If the episode is revealed before a prediction resolves, it is marked **void** and excluded from the score (and counted, so the numbers reconcile: resolved + void + pending = total).

**Idempotency.** Submitting the same prediction twice (a double click) must not create two records: the key `(episode, cursor position, horizon)` is unique and the second call returns the first record.

**State machine.** Episode: `open -> revealed` (one way). A revealed episode accepts no advance and no prediction.

Example: at day 60 the learner predicts `p = 0.7` for `h = 5`. The record is created with `made_at = 60`. Advancing to day 64 leaves it pending; advancing to day 65 resolves it from `close[65] > close[60]`. Trying to submit another prediction for day 60 and `h = 5` returns the existing one; trying to submit one for day 40 is rejected.

## Key terms
- precommitment: fixing a claim before the outcome can be known.
- append-only: records are added, never edited or deleted (outcome columns are written once).
- resolution: computing the outcome from data that has arrived.
- void: a prediction that could not be resolved because the episode ended.
- idempotent request: repeating it changes nothing the second time.
- state machine: the allowed transitions of an entity.

## Common mistakes / pitfalls
- Resolving with a query that is not bounded by the cursor (reads the future).
- Letting a client send the `made_at` position instead of using the server's cursor.
- Allowing `UPDATE` of `p` "just for corrections": it destroys the point of the record.
- Counting void predictions as misses, or dropping them silently.
- Forgetting that the final bars of an episode cannot be predicted at long horizons (reject them at creation).

## What to implement in this domain
- Tables `research.episode` and `research.prediction`; a trigger that allows `UPDATE` only to set the outcome of a prediction once, and rejects any other change and every `DELETE`.
- One module that owns all queries on these tables and bounds every bar read by the cursor.
- Unit and fuzz tests: 50 random cursors never expose a bar beyond the cursor; duplicate submissions are idempotent; edits are rejected by the database; reconciliation `resolved + void + pending = total`.

## How to check you understood
1. Why does the server, not the client, decide `made_at`? (A client could claim an earlier position and "predict" something already visible.)
2. What happens to a pending 10-bar prediction when the learner reveals? (It becomes void and is excluded from the score.)
3. Why a trigger rather than a code check? (The database enforces it for every code path, including future ones and manual SQL.)

## References
- [PostgreSQL: Trigger functions in PL/pgSQL](https://www.postgresql.org/docs/current/plpgsql-trigger.html): `BEFORE UPDATE`, `OLD`/`NEW`, `RAISE EXCEPTION` (read 2026-11-09).
- [Wikipedia: Pre-registration (science)](https://en.wikipedia.org/wiki/Pre-registration_(science)): the idea of committing before seeing results (read 2026-11-09).
- MarketLab blueprint 26.3 (replay boundary and idempotency invariants) and `docs/04-adr/0006` (replay reads through one layer).
