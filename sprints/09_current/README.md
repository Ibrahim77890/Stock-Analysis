# Sprint 09: Practice decisions and indicators (Python + NestJS + web)

## Goals
- A learner can switch on a **20-day average, an EMA and an RSI** on the episode chart, each with a plain sentence that it describes and does not predict (blueprint MVP item 5).
- A learner can **record a practice decision** (long or flat) with a written reason before the result is known, and later review it in a gentle journal: no scores, no ranks (MVP item 7).
- Indicators and decisions obey the **replay boundary**: nothing beyond the revealed day, no identity of an open episode; decisions are append-only, enforced in the schema.
- A seventh lesson connects indicators, decisions and doubt.
- The Sprint 06 to 08 walkthrough gap (a stranger and a screen reader) is tackled again.

## Why this sprint now
After Sprint 08 the MVP list in blueprint Section 21 has two items missing: inspect an indicator and record a simulated decision. Both reuse what exists (episodes, replay boundary, lessons, durable limits). Observability and the database benchmark (the last items) fit one more sprint. See the Sprint 08 entry in `sprints/current_status.md`.

**Size note:** 9 tasks. If time runs short, cut in this order and record it under `pending/`: the EMA and the text table in 09_05, the latency benchmark in 09_08, lesson 7. Do not cut the leak, causality and reconciliation checks, or the append-only trigger.

**Needs from the owner:** no keys. One person who has never seen the app (about 45 minutes) and NVDA (free) for 09_01; both are optional and the sprint continues without them.

## Learning concepts
1. [Causal technical indicators](concepts/09_01_causal-technical-indicators-sma-ema-rsi-and-why-they-describe-not-predict.md)
2. [Paper trading without future leakage](concepts/09_02_paper-trading-without-future-leakage-recording-a-decision-before-the-outcome.md)
3. [Decision journals and reflective practice](concepts/09_03_decision-journals-and-reflective-practice-for-beginners.md)
4. [What indicators and simple rules can and cannot tell you](concepts/09_04_what-indicators-and-simple-rules-can-and-cannot-tell-you.md)
5. [Accessible toggles, tabs and secondary chart panels](concepts/09_05_accessible-tabs-toggles-and-secondary-chart-panels.md)
6. [Append-only records and reconciling a ledger](concepts/09_06_append-only-records-and-reconciling-a-ledger.md)

## Tasks (in order)
| ID | Title | Layer | Depends on |
|---|---|---|---|
| [09_01](tasks/09_01_task.md) | Person-run walkthrough and screen-reader pass (carried over) | Web | none |
| [09_02](tasks/09_02_task.md) | Causal indicators in Python with Swagger | Python | none |
| [09_03](tasks/09_03_task.md) | Paper decisions in Python: append-only, marked without leakage | Python | 09_02 |
| [09_04](tasks/09_04_task.md) | Gateway: indicator and journal routes | NestJS | 09_02, 09_03 |
| [09_05](tasks/09_05_task.md) | Web: indicators on the episode chart | Web | 09_04 |
| [09_06](tasks/09_06_task.md) | Web: decision panel and My decisions journal | Web | 09_04 |
| [09_07](tasks/09_07_task.md) | Lesson 7: indicators, decisions and doubt | NestJS + Web | 09_05, 09_06 |
| [09_08](tasks/09_08_task.md) | Cross-layer checks | all | 09_02 to 09_07 |
| [09_09](tasks/09_09_task.md) | Documentation, fresh database, wrap-up | all | 09_01 to 09_08 |

## Out of scope / deferred
- Real-money trading, brokers, shorting, leverage, position sizing, stop orders, multi-symbol portfolios.
- More indicators (MACD, Bollinger), drawing tools, alerts.
- Observability dashboards and the Postgres versus DuckDB benchmark (candidate for Sprint 10), streaming, Docker, deployment, public sign-up.
- Carried-over: cold-cache benchmark, Alpaca agreement PDFs, Tiingo terms document, `05_P01`, `05_P02`.

## Definition of done
All acceptance criteria in 09_01 to 09_09 pass or the unfinished item is in `pending/` with a reason; Python, gateway and web suites pass (counts recorded); the leak, causality, reconciliation, isolation, contract and walk checks (and their negative tests) pass on the real stack; both OpenAPI contracts are refreshed; ADR 0019 exists; the whole stack rebuilds on an empty database.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 09 and plan the next one."
