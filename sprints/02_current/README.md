# Sprint 02: Leak-free reads: as-of adjusted prices, replay cursor and causal indicators

## Goals
- Close the Sprint 01 loose ends: licence terms, cold benchmark, cross-section index decision, real-data read test.
- Produce adjusted price series **as of a date**, never using future corporate actions.
- Enforce a replay cursor in one data-access layer and prove it with fuzz and truncation tests.
- Provide causal returns and indicators, each proven causal by an automatic test.
- Expose it all through a small read-only HTTP API with a lineage endpoint and honest caveats.

## Why this sprint now
Sprint 01 is done and verified (see `sprints/current_status.md`): trustworthy raw bars and corporate actions are loaded, but nothing can yet *use* them without risking look-ahead: adjusted prices do not exist, `get_bars` only has a date cap, and there are no indicators. The blueprint orders corporate actions, a replay-bounded read layer and causal indicators next (26.4 items 3 to 5), and every later feature (charts, replay, backtests) depends on them being leak-free (26.2).

## Learning concepts (read before the tasks that cite them)
1. [Adjusted prices computed as-of a date](concepts/02_01_adjusted-prices-as-of-and-look-ahead.md)
2. [The replay cursor and leakage testing](concepts/02_02_replay-cursor-and-leakage-testing.md)
3. [Returns and causal indicators](concepts/02_03_returns-and-causal-indicators.md)
4. [Golden-case and property-based testing](concepts/02_04_golden-and-property-based-testing.md)
5. [A small HTTP read API with FastAPI](concepts/02_05_http-read-api-with-fastapi.md)
6. [Indexing for cross-sectional queries](concepts/02_06_indexing-for-cross-sectional-queries.md)
7. [Data feeds, volume semantics and lineage](concepts/02_07_data-feeds-volume-and-lineage.md)

## Tasks (in order)
| ID | Title | Depends on |
|---|---|---|
| [02_01](tasks/02_01_task.md) | Close the Sprint 01 loose ends | none |
| [02_02](tasks/02_02_task.md) | As-of corporate-action adjustment factors | none |
| [02_03](tasks/02_03_task.md) | Adjusted reads through `get_bars` | 02_02 |
| [02_04](tasks/02_04_task.md) | Replay data-access layer and blind view | 02_03 |
| [02_05](tasks/02_05_task.md) | Returns and causal indicators with a truncation test | 02_03 |
| [02_06](tasks/02_06_task.md) | Read-only HTTP API with cursor and adjustment | 02_03, 02_04, 02_05 |
| [02_07](tasks/02_07_task.md) | Data lineage endpoint with caveats | 02_06 |
| [02_08](tasks/02_08_task.md) | ADRs, docs, close sprint | all |

## Out of scope / deferred
- Backtest engine, costs, metrics, shuffle test (a later sprint, after this one proves causality).
- NestJS service, frontend, charts, authentication, paper trading, lessons.
- Intraday bars, fundamentals (SEC), delisted symbols and the survivorship demo.
- DuckDB / ClickHouse comparison, partitioning, BRIN (unless the 02_01 measurement justifies it).
- Spin-offs, mergers and symbol changes in adjustments.
- Longer history through the SIP feed (only a decision paragraph in 02_01).

## Definition of done
All acceptance criteria in tasks 02_01-02_08 pass (or unfinished items are in `pending/` with reasons), the suite passes with `TEST_DATABASE_URL` set, the replay-boundary and causality tests (including their negative tests) pass, the OpenAPI contract is committed, and the ADRs are written.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 02 and plan the next one."
