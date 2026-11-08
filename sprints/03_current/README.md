# Sprint 03: An honest backtest: next-open fills, costs, metrics, luck controls and a reproducibility hash

## Goals
- A single-asset, long-only daily backtest engine with an explicit, documented execution model (signal at the close, fill at the next open).
- Costs as a first-class input, with a cost sensitivity sweep and a buy-and-hold baseline.
- Standard metrics with stated conventions, proven against hand-computed cases.
- Tools that teach distrust: a look-ahead detector (fill-model comparison), an engine truncation test, and a bootstrap/random-walk luck control.
- Reproducible runs: canonical config, dataset fingerprint and result hash stored in a new `research` schema; every function testable in Swagger.

## Why this sprint now
Sprint 02 is done and verified (see `sprints/current_status.md`): raw bars, as-of adjustment, the replay layer and causal indicators exist, with 96 tests passing. Blueprint 26.4 puts the backtest engine (item 6) and validation (item 7) next, and 26.2 lists "results without costs" and "leaking future data" as the ways to invalidate the project, so costs, causality tests and luck controls ship with the engine, not after it.

## Learning concepts
1. [Backtest mechanics and fill timing](concepts/03_01_backtest-mechanics-and-fill-timing.md)
2. [Moving-average crossover](concepts/03_02_moving-average-crossover.md)
3. [Transaction costs, slippage and cost sensitivity](concepts/03_03_transaction-costs-and-sensitivity.md)
4. [Performance metrics](concepts/03_04_performance-metrics.md)
5. [Luck controls: bootstrap and shuffle test](concepts/03_05_luck-controls-shuffle-and-bootstrap.md)
6. [Reproducibility hashing](concepts/03_06_reproducibility-hashing.md)

## Tasks (in order)
| ID | Title | Depends on |
|---|---|---|
| [03_01](tasks/03_01_task.md) | Design the backtest contract and create the `research` schema | none |
| [03_02](tasks/03_02_task.md) | Backtest engine v1 (SMA crossover, next-open fills, costs) | 03_01 |
| [03_03](tasks/03_03_task.md) | Performance metrics and the buy-and-hold benchmark | 03_02 |
| [03_04](tasks/03_04_task.md) | Engine causality tests and the look-ahead detector | 03_02 |
| [03_05](tasks/03_05_task.md) | Persist runs with a reproducibility hash | 03_01, 03_03 |
| [03_06](tasks/03_06_task.md) | Cost sensitivity sweep | 03_03 |
| [03_07](tasks/03_07_task.md) | Luck control (bootstrap and random-walk shuffle test) | 03_03 |
| [03_08](tasks/03_08_task.md) | Expose every backtest function in Swagger | 03_04 to 03_07 |
| [03_09](tasks/03_09_task.md) | Documentation, end-to-end check and sprint wrap-up | all |

## Out of scope / deferred
- Short selling, leverage, stops/targets (daily bars hide the intrabar path), multiple assets, portfolios, dividends in total return.
- In-sample/out-of-sample splits, walk-forward, deflated Sharpe, overfitting meter (next validation sprint).
- Risk-free rate from FRED, factor regressions.
- Frontend charts, NestJS, authentication, lessons, paper trading, prediction scoring.
- Cold-cache benchmark (needs an administrator restart of PostgreSQL), API latency measurement, Alpaca agreement PDFs, delisted symbols.
- Any new infrastructure (no queue, no new store).

## Definition of done
All acceptance criteria in 03_01 to 03_09 pass or the unfinished item is in `pending/` with a reason; the suite passes with `TEST_DATABASE_URL`; truncation, reproducibility and accounting-identity tests (and their negative tests) pass; the OpenAPI contract is refreshed; the ADRs 0009 and 0010 and `docs/02-domain/backtest.md` exist.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 03 and plan the next one."
