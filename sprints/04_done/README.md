# Sprint 04: Validation: out-of-sample, walk-forward, deflated Sharpe and selection bias

## Goals
- Make every parameter search count itself: a trial registry in the `research` schema and an overfitting meter (number of trials, expected best-of-N Sharpe under no skill, deflated Sharpe).
- Judge a rule on data it never saw: time split with embargo and warm-up, a one-use holdout, and walk-forward analysis with parameter-stability reporting.
- Show selection bias with MarketLab's own data: the same rule over all eligible symbols compared with the best of N simulated random walks, with an explicit universe caveat.
- Show where a result came from: breakdown by calendar year and by volatility regime, reconciled to the total.
- Keep it testable by hand: every function has a Swagger endpoint under "Validation".

## Why this sprint now
Sprint 03 is done and verified (see `sprints/current_status.md`): the engine, costs, metrics, hashes and a single-run luck control exist, and the real results already warn that a rule can look fine alone and be ordinary against luck. Blueprint 26.4 item 7 (validation) is the next step, and 23.1 says the product teaches distrust of results. Nothing here can be skipped by a UI later, because a search without a trial count would be a new way to fool oneself. Constraint from the data: every symbol has 1,362 to 1,367 bars and the contiguous window starts on 2020-07-27 (SPY and DIS each hold one isolated earlier bar, found by the Sprint 04 audit), so splits are small and outputs are noisy.

## Learning concepts
1. [Overfitting, data snooping and multiple testing](concepts/04_01_overfitting-and-multiple-testing.md)
2. [In-sample, out-of-sample, embargo and the frozen holdout](concepts/04_02_in-sample-out-of-sample-embargo-and-holdout.md)
3. [Walk-forward analysis](concepts/04_03_walk-forward-analysis.md)
4. [How uncertain is a Sharpe ratio? PSR and DSR](concepts/04_04_sharpe-uncertainty-psr-and-dsr.md)
5. [Selection bias: best of N symbols, and survivorship](concepts/04_05_selection-bias-best-of-n-and-survivorship.md)
6. [Regimes and non-stationarity](concepts/04_06_regimes-and-non-stationarity.md)

## Tasks (in order)
| ID | Title | Depends on |
|---|---|---|
| [04_01](tasks/04_01_task.md) | Validation protocol, data-window audit and the trial registry | none |
| [04_02](tasks/04_02_task.md) | Parameter grid search with trial recording | 04_01 |
| [04_03](tasks/04_03_task.md) | Train/test split with embargo and a one-use holdout | 04_02 |
| [04_04](tasks/04_04_task.md) | Walk-forward analysis | 04_03 |
| [04_05](tasks/04_05_task.md) | Probabilistic and deflated Sharpe, and the overfitting meter | 04_02 |
| [04_06](tasks/04_06_task.md) | Universe scan and the best-of-N control | 04_05 |
| [04_07](tasks/04_07_task.md) | Regime breakdown by year and by volatility | 04_01 |
| [04_08](tasks/04_08_task.md) | Expose every validation function in Swagger | 04_02 to 04_07 |
| [04_09](tasks/04_09_task.md) | Documentation, end-to-end validation example and sprint wrap-up | all |

## Out of scope / deferred
- Dividends in total return and a risk-free rate series (FRED needs an API key; a no-key Treasury CSV could be a later data task).
- Anchored walk-forward, purged k-fold, effective-N estimation, White's reality check, minimum track-record length.
- Delisted names and a survivorship demonstration (needs another dataset and licence reading).
- More strategies than the SMA crossover; portfolios, shorting, stops.
- Frontend charts, NestJS, authentication, lessons, prediction scoring, paper trading.
- Cold-cache benchmark (administrator restart of PostgreSQL), API latency measurement, Alpaca agreement PDFs.
- Any new infrastructure (no queue, no new store).

## Definition of done
All acceptance criteria in 04_01 to 04_09 pass, or the unfinished item is in `pending/` with a reason; the suite passes with `TEST_DATABASE_URL`; the leakage, holdout, reconciliation and reproducibility tests (and their negative tests) pass; the OpenAPI contract is refreshed; ADR 0012, `docs/02-domain/validation.md` and the generated worked example exist and reproduce on a fresh database.

## How to close
Tell the `domain-sprint-decision` agent: "close sprint 04 and plan the next one."
