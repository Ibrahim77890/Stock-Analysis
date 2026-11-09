# Sprint 06: A blind learning loop: replay, guess, get scored (Python + NestJS + web)

## Goals
- A learner can create an account, open a web page, replay a **blind** price series (name, dates and price level hidden; a mix of real and made-up series) and send **precommitted probability guesses** that can never be edited.
- Honest scoring in Python: Brier score against a coin flip, a calibration plot with counts and uncertainty, a seeded luck check, and a clear "too few guesses" rule.
- The first **three-service architecture**: Vite + React web app -> **NestJS gateway** (logins, ownership, validation, glossary, request trace; owns schema `app`) -> **Python analytics** (data, episodes, scores; owns `market` and `research`).
- A **beginner-friendly, light-coloured** interface: plain language, a guided tour, every technical word explained on the spot, no dark mode in this sprint.
- **Visibility** ("Under the hood"): a diagram of how the system works, live status of each part, what the server hides and keeps for the current episode, and a table of the learner's own recent requests.

## Why this sprint now
Sprints 01 to 05 built and verified the data layer, the leak-free reads, the backtest, the validation tools and a second source (see `sprints/current_status.md`). Everything is reachable only through Swagger. The blueprint's remaining arc is the user-facing slice (sections 5.2, 23.2, 24) and the product principle is to teach people to distrust their own results; a guess-and-score loop does exactly that on a person's own judgement. The existing replay session still echoes the symbol and start date, which makes "blind" a label, not a fact. The owner asked on 2026-11-09 for NestJS (backend and gateway), a beginner-friendly light UI and more visibility in this sprint.

**Size note:** 13 tasks, above the usual 5 to 10, by the owner's request. If time runs short, cut in this order and record it under `pending/`: 06_11 (visibility page), the trace part of 06_07, the latency part of 06_12, the progress page of 06_10. Do not cut tests, the leak scans or the beginner walkthrough.

**Needs from the owner:** no new vendor keys. Two secrets are generated on this machine and kept in the git-ignored `.env` (`JWT_SECRET`, `INTERNAL_API_TOKEN`); placeholders and the generating command go into `.env.example`. Node 20.19 is installed (enough to run the apps; the NestJS generators need a newer Node, so the scaffold is written by hand, or install Node 22 LTS). One person who did not build the app should follow the walkthrough in 06_12.

## Learning concepts
1. [Hindsight bias and what "blind" must hide](concepts/06_01_hindsight-bias-and-what-blind-must-hide.md)
2. [Probability forecasts, proper scoring rules and the Brier score](concepts/06_02_probability-forecasts-proper-scoring-and-brier-score.md)
3. [Calibration, reliability diagrams and sample size](concepts/06_03_calibration-reliability-diagrams-and-sample-size.md)
4. [Overconfidence, luck and the permutation check](concepts/06_04_overconfidence-luck-and-the-permutation-check.md)
5. [Precommitment, append-only records and resolving outcomes](concepts/06_05_precommitment-append-only-records-and-resolving-outcomes.md)
6. [A typed frontend over a typed API](concepts/06_06_a-typed-frontend-over-a-typed-api.md)
7. [Two backends, one contract: a NestJS gateway and Python analytics](concepts/06_07_two-backends-one-contract-nestjs-gateway-and-python-analytics.md)
8. [Designing for novices: plain language, progressive disclosure and a light theme](concepts/06_08_designing-for-novices-plain-language-and-a-light-theme.md)

## Tasks (in order)
| ID | Title | Layer | Depends on |
|---|---|---|---|
| [06_01](tasks/06_01_task.md) | Architecture decision (ADR 0014), NestJS gateway scaffold, local secrets, typed Python client | NestJS | none |
| [06_02](tasks/06_02_task.md) | Blind episodes: seeded, real and made-up mix, no side channels | Python | none |
| [06_03](tasks/06_03_task.md) | Precommitted guesses, append-only, resolved from later bars | Python | 06_02 |
| [06_04](tasks/06_04_task.md) | Scoring functions: Brier, calibration, decomposition, luck check | Python | none |
| [06_05](tasks/06_05_task.md) | Score, reveal, lineage endpoints, internal token, Swagger "Learning" | Python | 06_03, 06_04 |
| [06_06](tasks/06_06_task.md) | NestJS `app` schema, learners and login | NestJS | 06_01 |
| [06_07](tasks/06_07_task.md) | NestJS learning gateway, glossary as data, request trace, system status | NestJS | 06_05, 06_06 |
| [06_08](tasks/06_08_task.md) | Web foundation: light theme, beginner shell, login, tour, term help | Web | 06_07 |
| [06_09](tasks/06_09_task.md) | Episode screen: blind chart, three-step coach, guess form | Web | 06_08 |
| [06_10](tasks/06_10_task.md) | Score, reveal and progress screens with plain explanations | Web | 06_09 |
| [06_11](tasks/06_11_task.md) | "Under the hood": diagram, live status, what the server knows, my requests | Web | 06_10 |
| [06_12](tasks/06_12_task.md) | Cross-layer checks: leak fuzz, learner isolation, end-to-end, latency, beginner walkthrough | all | 06_11 |
| [06_13](tasks/06_13_task.md) | Documentation, fresh-database reproduction and wrap-up | all | 06_01 to 06_12 |

(06_01, 06_02 and 06_04 have no dependencies and can run in parallel; the order above keeps every dependency earlier in the list.)

## Out of scope / deferred
- Lessons, quizzes, progress beyond guess scores, trade journal and behaviour review, paper trading, strategy lab UI, indicators on the chart.
- Dark mode and any second theme; translations; mobile-specific layouts; deployment; Docker.
- Public sign-up, password reset, email, OAuth, roles, refresh tokens (accounts only separate learners on one machine).
- Playwright or other browser automation (the written walkthrough is the browser check); load or penetration testing.
- Showing Tiingo-derived charts to anyone but the owner (licence: internal use only); a redistributable or synthetic-only mode is a later decision.
- Any new infrastructure (no queue, no cache, no extra database).
- Carried-over open items: cold-cache benchmark, Alpaca agreement PDFs, Tiingo terms-of-service document, the Alpaca duplicate-dividend rule (`05_P01`), vendor-coded spin-offs (`05_P02`).

## Definition of done
All acceptance criteria in 06_01 to 06_13 pass, or the unfinished item is in `pending/` with a reason; the Python suite, the gateway suite and the web suite pass (counts recorded); the identity-leak fuzz, learner-isolation fuzz, direct-access check and the append-only trigger tests (and their negative tests) pass; a person who did not build the app has followed the walkthrough and every hesitation is fixed or listed; both OpenAPI contracts are refreshed; ADRs 0014 and 0015, the learning-loop and system-overview documents exist; the whole stack rebuilds on an empty database from the local files.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 06 and plan the next one."
