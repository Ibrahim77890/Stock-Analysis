# ADR 0015: Blind episodes and the precommitted prediction protocol

Status: accepted (Sprint 06, 2026-11-09)

## Context
The learning loop is only believable if the learner cannot recognise the chart, cannot see beyond the cursor, and cannot edit a guess after seeing the result (blueprint 23.2). The Sprint 02 replay session echoed the symbol and start date at creation and showed volume in absolute terms, so "blind" was a label.

## Decision
- **Episode** (`research.episode`, owned by Python): `open -> revealed`, one way. A revealed episode accepts no advance and no guess. The learner sees `day` 1..cursor, never dates.
- **What is hidden, and how:** symbol, name, sector, real dates and years, absolute price level and absolute volume, adjustment factors, and (for a "mixed" request) whether the series is real or generated. Prices are rebased so the first visible close is exactly 100; volume is divided by the mean of the first visible bars (`rel_volume`). Both scales use only bars that are already visible and are recomputed per call, so with real data numerator and scale carry the same split factor and splits stay invisible (a fixed scale stored at creation would have leaked every split, because adjusted volume changes after the ex-date). Real bars are split-adjusted as of the cursor date.
- **Mixed real and generated episodes:** recognisable crashes cannot be hidden by presentation, so half of "mixed" episodes are seeded zero-drift random walks (`market/synthetic.episode_series`). The kind is shown only after the reveal. On generated episodes no honest forecaster beats a coin flip, which the progress page uses to show how easy it is to see patterns in noise.
- **Determinism:** an episode is rebuilt from its seed (kind, symbol, start and series); the same seed gives byte-identical blind bars. The cursor is the only mutable state.
- **Guess** (`research.prediction`): `(episode, made_at, horizon, p_up)` with horizon in {1, 5, 10} bars and `p_up` in [0.01, 0.99] with at most 4 decimals. `made_at` is the **server's** cursor (the client cannot send it) and `made_at + horizon` must lie inside the episode. The key `(episode, made_at, horizon)` is unique; a repeat returns the first record (`created = false`).
- **Append-only:** a database trigger rejects every `DELETE` and every `UPDATE` except one transition of a pending row to `resolved` (with an outcome and the resolution position) or `void`; `p_up`, `horizon`, `made_at` and `created_at` can never change.
- **Resolution:** when the cursor advances to position c, every pending guess with `made_at + horizon <= c` is resolved from the closes of positions <= c: outcome 1 if `close[made_at + horizon] > close[made_at]` (strictly; ties count as 0). A test records the highest position read and fuzzes it.
- **Void:** guesses still pending at the reveal become `void` and are not scored; `resolved + void + pending = total` always (enforced in code and tested).
- **Scoring** (pure functions in `learning/scoring.py`, see `docs/02-domain/scoring.md`): Brier score, calibration bins with Wilson intervals, Murphy decomposition, baselines, and a seeded permutation luck check shuffled within each horizon; below 30 answered guesses no skill or luck statement is made.
- **Reveal** is the only place identity leaves the Python module (`learning/episode.py` is the only module with SQL on the two tables; a structural test enforces it). Real episodes also return a data trail (provider, retrieved-at, adjustment, survivorship and licence caveats).
- **Anonymity:** Python stores no user; the gateway maps learners to episodes.

## Alternatives
Client-side state (editable, leaks identity); letting learners edit or withdraw a guess (destroys the point of precommitment); hiding only the symbol (volume, level and dates still identify the series); a fixed volume scale computed at creation (leaks splits); counting void guesses as misses (penalises quitting early).

## Consequences
A learner cannot undo a mistaken guess. Famous real episodes can still be recognised from shape alone; the kind of a mixed episode being hidden reduces, not removes, that. Scores are noisy below 30 guesses and overlapping horizons are not independent; the screens say so.
