# Sprint 08: Guided lessons and a durable platform base (NestJS + web)

## Goals
- A beginner can follow a **path of six short lessons** (candles, what a probability means, the Brier score, calibration, luck and many tries, costs and the vault), each with one idea at a time, an optional small demo and three questions with explained feedback, and is pointed to the Learn or Lab screen that practises the idea.
- Answers are **checked on the server**; the answer key never reaches the browser; progress is private, idempotent and a record, not a grade (no scores, ranks or points).
- Lesson text is **validated data** (schema, reading ease, glossary markers, banned words, versions), loaded by an idempotent seed.
- The in-memory **rate limiter and request trace** become durable (PostgreSQL), so limits survive a restart and cannot be passed by two simultaneous requests.
- The Sprint 06 and 07 walkthrough gap is closed with **a real person** and a **screen-reader pass**.

## Why this sprint now
Sprints 06 and 07 gave learners powerful tools (a blind guess-and-score loop and a Strategy Lab) and a redesigned interface, but no path: a beginner meets them without knowing which idea comes first or whether they understood it. The owner asked for a good learning interface; guided lessons with retrieval practice are the missing piece. The two in-memory components and the untested-by-a-person interface are the open risks in `sprints/current_status.md` and `07_done/pending/`. See the Sprint 07 entry in `sprints/current_status.md`.

**Size note:** 8 tasks. If time runs short, cut in this order and record it under `pending/`: the three demos in 08_06 (keep the generator), the latency benchmark in 08_07, the screen-reader part of 08_01. Do not cut the answer-key leak test, the concurrency and isolation tests, or the person-run walkthrough.

**Needs from the owner:** no new keys or secrets. One person who has never seen the app (about 45 minutes) for 08_01; NVDA (free) installed on this Windows machine for the screen-reader pass. Tiingo data stays internal-use only; the lessons use made-up examples and the existing stack.

## Learning concepts
1. [Learning design for beginners: worked examples, retrieval practice and feedback](concepts/08_01_learning-design-for-beginners-worked-examples-retrieval-practice-and-feedback.md)
2. [Content as data: lesson schemas, validation and versioning](concepts/08_02_content-as-data-lesson-schemas-validation-and-versioning.md)
3. [Checking answers on the server and idempotent progress](concepts/08_03_checking-answers-on-the-server-and-idempotent-progress.md)
4. [Durable rate limiting and request logs in PostgreSQL](concepts/08_04_durable-rate-limiting-and-request-logs-in-postgresql.md)
5. [Explorable explanations: small demos that teach one idea](concepts/08_05_explorable-explanations-small-demos-that-teach-one-idea.md)
6. [Testing accessibility: keyboard, the accessibility tree and screen readers](concepts/08_06_testing-accessibility-keyboard-accessibility-tree-and-screen-readers.md)

## Tasks (in order)
| ID | Title | Layer | Depends on |
|---|---|---|---|
| [08_01](tasks/08_01_task.md) | Person-run walkthrough, screen-reader pass and fixes (carried over from 07_01) | Web | none |
| [08_02](tasks/08_02_task.md) | Lesson content as validated data: schema, six lessons, idempotent seed | NestJS | none |
| [08_03](tasks/08_03_task.md) | Gateway lessons module: progress, server-side answer checking, ownership | NestJS | 08_02 |
| [08_04](tasks/08_04_task.md) | Durable rate limiter and request trace in PostgreSQL (carried over from 06_P02 and 07_P02) | NestJS | none |
| [08_05](tasks/08_05_task.md) | Web learning path and lesson page with questions | Web | 08_03 |
| [08_06](tasks/08_06_task.md) | Three small interactive demos inside the lessons | Web | 08_05 |
| [08_07](tasks/08_07_task.md) | Cross-layer checks for lessons and durable limits | all | 08_03, 08_04, 08_06 |
| [08_08](tasks/08_08_task.md) | Documentation, fresh-database reproduction and wrap-up | all | 08_01 to 08_07 |

(08_01, 08_02 and 08_04 have no dependencies and can run in parallel; the order above keeps every dependency earlier in the list.)

## Out of scope / deferred
- Scores, badges, streaks, leaderboards, certificates; more than six lessons; a lesson editor; translations.
- New quantitative features (other rules, walk-forward or regime views in the Lab), a paper-trading or trade-journal feature (candidates for Sprint 09).
- Dark mode, mobile-specific layouts, Docker, deployment, public sign-up, password reset, token storage hardening.
- Redis or any new infrastructure; load or penetration testing.
- Carried-over open items other than those above: cold-cache benchmark, Alpaca agreement PDFs, Tiingo terms document, `05_P01`, `05_P02`.

## Definition of done
All acceptance criteria in 08_01 to 08_08 pass, or the unfinished item is in `pending/` with a reason; the Python, gateway and web suites pass (counts recorded); the answer-key leak fuzz, concurrency, isolation, restart and contract tests (and their negative tests) pass on the real stack; a person who did not build the app has followed the walkthrough and every hesitation is fixed or listed; both OpenAPI contracts are refreshed; ADR 0018 and `lessons.md` exist; the whole stack rebuilds on an empty database and the lesson content hash matches.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 08 and plan the next one."
