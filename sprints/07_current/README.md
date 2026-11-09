# Sprint 07: Strategy Lab: test a rule, then doubt it (Python + NestJS + web)

## Goals
- A learner can pick a stock, describe one simple rule (a moving-average crossover) and run it on the **practice years** of that stock, always shown **beside buy and hold**, with costs, a luck control and a count of how many ideas have been tried.
- Each study keeps a **vault**: the most recent years (about 1,000 trading days) that no practice run can see. It can be opened **once**, on one chosen rule, and the learner then sees practice and vault side by side. The lesson is felt, not told: the more ideas tried, the more the best one looks lucky.
- Hard limits (rule sizes, number of tries, shuffled paths, runs per minute, studies per learner) so an expensive endpoint cannot be abused, and a plain message for every limit.
- The beginner walkthrough from Sprint 06 is finally run **by a person who did not build the app**, and the browser walk becomes a repeatable script with a keyboard-only mode (closes the main open items of Sprint 06).
- Everything is visible in Swagger (Python "Lab" section and the gateway), light-coloured and in plain language.

## Why this sprint now
Sprints 03 and 04 built the backtest engine and the honesty tools (shuffle test, trial registry, one-use holdout, overfitting meter), but only a developer in Swagger can use them. Sprint 06 gave the platform its first user-facing slice (a blind guess-and-score loop) and its three-service architecture. The blueprint's next user-facing step (sections 9, 23.2) is a lab where a beginner tries a rule and learns to distrust it. The tools already exist, so this sprint composes them for a person and adds the protections that exposing them requires. See `sprints/current_status.md` for the state after Sprint 06.

**Size note:** 9 tasks. If time runs short, cut in this order and record it under `pending/`: the screen-reader listening part of 07_01, the benchmark note of 07_08, the regime/yearly extras in 07_06 (keep the yearly table). Do not cut the vault tests, the leak fuzz, the isolation fuzz or the person-run walkthrough.

**Needs from the owner:** no new vendor keys and no new secrets (one optional setting `LAB_RUNS_PER_MINUTE` in `.env.example`). One person who has not seen the app is needed for 07_01 (about 30 minutes). Microsoft Edge or Chrome must be installed for the browser walk. Tiingo data remains for the owner's internal use only (licence); the Lab is for local use.

## Learning concepts
1. [What a backtest shows and what it does not](concepts/07_01_what-a-backtest-shows-and-what-it-does-not.md)
2. [Trying many ideas: overfitting and the number of tries](concepts/07_02_trying-many-ideas-overfitting-and-the-number-of-tries.md)
3. [The vault: out-of-sample holdout and one-use tests](concepts/07_03_the-vault-out-of-sample-holdout-and-one-use-tests.md)
4. [Luck controls for a strategy](concepts/07_04_luck-controls-for-a-strategy.md)
5. [Protecting expensive endpoints](concepts/07_05_protecting-expensive-endpoints.md)
6. [Explaining performance numbers and charts to beginners](concepts/07_06_explaining-performance-numbers-and-charts-to-beginners.md)

## Tasks (in order)
| ID | Title | Layer | Depends on |
|---|---|---|---|
| [07_01](tasks/07_01_task.md) | Beginner walkthrough with a real person, repeatable browser walk, fixes (carried over from 06_12) | Web | none |
| [07_02](tasks/07_02_task.md) | Lab core: studies with a vault, practice runs, tries counted | Python | none |
| [07_03](tasks/07_03_task.md) | Lab endpoints (Swagger "Lab"), internal token, limits and errors | Python | 07_02 |
| [07_04](tasks/07_04_task.md) | Gateway lab module: studies per learner, validation, rate limit, whitelist | NestJS | 07_03 |
| [07_05](tasks/07_05_task.md) | Web foundation: pick a stock, start a study, write a rule | Web | 07_04 |
| [07_06](tasks/07_06_task.md) | Web results: honest cards, growth chart, costs, luck, ideas tried | Web | 07_05 |
| [07_07](tasks/07_07_task.md) | Web vault flow: open once, compare practice and vault | Web | 07_06 |
| [07_08](tasks/07_08_task.md) | Cross-layer checks: leaks, isolation, limits, contract, speed, real browser | all | 07_04, 07_07, 07_01 |
| [07_09](tasks/07_09_task.md) | Documentation, fresh-database reproduction and wrap-up | all | 07_01 to 07_08 |

(07_01 and 07_02 have no dependencies and can run in parallel; the order above keeps every dependency earlier in the list.)

## Out of scope / deferred
- Rules other than the moving-average crossover; parameter grids or automatic search; walk-forward and regime views in the Lab; more than one symbol per study; portfolio or short selling.
- Lessons, quizzes, trade journal, paper trading, alerts, export or sharing of results.
- Dark mode, translations, mobile-specific layouts, deployment, Docker, public sign-up.
- A durable (database-backed) rate limiter and trace, token storage hardening (`pending` from Sprint 06).
- Load or penetration testing; screen-reader coverage beyond one listening pass.
- Any new data source or new infrastructure (no queue, no cache, no extra database).
- Carried-over open items other than the walkthrough: cold-cache benchmark, Alpaca agreement PDFs, Tiingo terms document, `05_P01`, `05_P02`.

## Definition of done
All acceptance criteria in 07_01 to 07_09 pass, or the unfinished item is in `pending/` with a reason; the Python, gateway and web suites pass (counts recorded); the vault leak fuzz, data-change test, isolation fuzz, caps and rate-limit tests (and their negative tests) pass on the real stack; a person who did not build the app has followed the walkthrough and every hesitation is fixed or listed; both OpenAPI contracts are refreshed; ADR 0017 and `lab.md` exist; the whole stack rebuilds on an empty database and the Lab fingerprint matches.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 07 and plan the next one."
