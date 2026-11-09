# ADR 0017: Strategy Lab: practice window, one-use vault and counted tries

Status: accepted (Sprint 07, 2026-11-09)

## Context
Sprints 03 and 04 built the backtest engine and the honesty tools (shuffle test, trial registry, one-use holdout, overfitting meter), but only a developer in Swagger could use them. The blueprint's user-facing step (sections 9 and 23.2) is a lab where a beginner tries a rule and learns to doubt it. Exposing an expensive endpoint to people also needs limits.

## Decision
- **Study** (`research.lab_study`, one row per study, owned by Python): a `research.study` of family `lab_sma` plus `practice_end`, `vault_bars` (default 1,000 trading days, between 120 and 1,500), the source (`tiingo`) and, once the vault is opened, the rule used (`vault_fast`, `vault_slow`, `vault_cost_bps`). `lab/study.py` is the only module with SQL on this table (a structural test enforces it).
- **Practice window and vault.** The practice end is fixed when the study is created: the vault is the last `vault_bars` stored sessions, with an embargo of 5 sessions between practice end and vault start. It is never recomputed from "today's" data. Practice runs read bars with `end = practice_end`, so prices are adjusted as of that date (`split_dividend`) and no vault row is read; a test deletes every bar after the practice end and recomputes byte-identical results.
- **One use.** `open_vault` goes through the Sprint 04 `final_holdout_evaluation`: a second call raises `HoldoutAlreadyUsedError` (HTTP 409) and changes nothing. The vault opens only for a rule that was already run on the practice years, so the number of ideas tried is honest. Warm-up for the vault comes from earlier bars (`slow` of them); the scored series starts at the first vault session. Both runs use the same engine and fill model (`next_open`, costs as slippage).
- **What counts as a trial.** Each distinct `(fast, slow, cost_bps)` run is one trial (phase `train`). Repeating the same run is recomputed and returned with `counted = false`; it adds no row. A different cost counts as a new idea. The overfitting meter appears from the second trial on and is shown as a warning light.
- **Same numbers every time.** Identical inputs and seed give identical output; the response carries the config hash and dataset fingerprint.
- **Limits (authoritative in Python, mirrored in the gateway and the form):** `2 <= fast < slow <= 300`, cost 0 to 50 basis points, 10 to 200 mixed-up histories (default 100), at most 200 trials per study, one vault use, at most 6,000 bars per run, at most 20 studies per learner, 20 runs and 3 vault tries per minute per learner (the gateway answers 429 with `Retry-After`). The equity curves are cut to at most 300 points, first and last kept.
- **What leaves Python before the vault opens.** Years of history as counts, practice dates up to and including the practice end (they are on the chart), no vault date, no vault number, no `practice_end` field. The gateway rebuilds every reply from field lists (`lab/whitelist.ts`), so a field that a faulty Python adds is dropped and logged by name.
- **Ownership.** `app.learner_study` (gateway) maps learners to study ids. Another learner's id, an unknown id and a malformed id all give the same 404 and no call to Python.
- **Comparison the page makes.** Practice and vault are compared on the Sharpe ratio (it does not depend on the window length); the page writes one fixed sentence per case (much worse, similar, better, unknown) and never a verdict on the rule. Charts start both lines at 100 on a log axis and carry a text table.

## Alternatives considered and rejected
- A parameter grid or automatic search in the browser: invites the very overfitting the Lab is meant to show, and multiplies the cost of one request.
- A vault that can be reset or opened again "for convenience": it destroys the lesson. The learner starts a new study on another stock instead.
- Showing vault dates or the vault length in dates before the opening: lets people guess the period from memory.
- Counting repeats as new ideas: punishes a learner for looking at a result again.
- Background jobs for runs: one run takes a few seconds; a queue would be new infrastructure without a measured reason.

## Consequences
The Lab shows how a good practice result can fall apart on unseen years, which is the intended lesson. It cannot find a rule that works, and the screens say so. One stock and one stretch of time remain one sample. The rate limiter and the request trace are in memory and reset when the gateway restarts. The Tiingo data licence is internal use only, so the Lab is for the owner's machine.
