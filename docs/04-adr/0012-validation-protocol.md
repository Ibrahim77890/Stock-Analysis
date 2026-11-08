# ADR 0012: Validation protocol (studies, trials, splits, one-use holdout)

Status: accepted (Sprint 04)

## Context
Sprint 03 can score one parameter pair. Any search over pairs, symbols or windows is a source of selection bias (blueprint 23.2, 26.2). The loaded data are short: the Sprint 04 audit (data-profile-v1.md) shows all 53 symbols have 1,362 to 1,367 bars and that the contiguous window of the whole universe is 2020-07-27 to 2025-12-31: DIS (2018-04-25) and SPY (2018-11-01) each hold one isolated earlier bar followed by a gap of about 20 months. Splits must be small and must start at the contiguous window (2020-07-27).

## Decision
- **Study**: one search on one symbol and strategy family (`research.study`). **Trial**: one evaluated parameter pair on one window, with its phase (`research.trial`). Every pair a grid search evaluates is recorded, including the poor ones; trials are never deleted or edited. Re-running a search adds trials (attempts count).
- **Phases**: `train` (used to choose), `test` (one evaluation of the chosen pair on later bars), `holdout` (final one-use evaluation).
- **Splits are by time**, never shuffled. Training uses only bars up to its end; an **embargo** of 5 bars (default) separates train and test; the test run receives `slow` bars of earlier data as **warm-up** (past data may feed indicators) but is scored from its first test bar, starting flat.
- **Holdout is one-use**: `final_holdout_evaluation` records phase `holdout`, sets `holdout_used_at` and refuses a second call (`HoldoutAlreadyUsedError`, HTTP 409).
- **Minimum window**: a split needs at least 300 training bars and 60 test bars (about 1.2 years and 3 months); walk-forward needs at least one full fold. Below this, results are not reported as validation. Reason: with 1,366 bars, 50-bar averages and a handful of trades per year, shorter blocks contain too few trades to say anything.
- **Deflation**: the overfitting meter uses the registry's trial count N, the cross-trial variance of Sharpe estimates, and the deflated Sharpe ratio (docs/02-domain/validation.md). N is a lower bound: ideas tried elsewhere are not counted.

## Alternatives
Random k-fold (leaks the future); purged/combinatorial cross-validation (heavier, deferred); anchored walk-forward (deferred); storing only the winning trial (hides the number of tries).

## Consequences
Honest numbers are noisier and usually worse than in-sample numbers; that is the intended lesson. The registry cannot know about searches made outside it, so the DSR is a warning light, not a verdict. Equal-looking neighbouring pairs overstate the effective number of trials.
