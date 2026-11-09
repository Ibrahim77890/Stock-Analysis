# Probability forecasts, proper scoring rules and the Brier score

**Sprint:** 06    **Used by tasks:** 06_03, 06_04, 06_05, 06_09, 06_13

## Why this matters for MarketLab
"Up or down?" hides how sure the learner is. Asking for a probability and scoring it with a proper rule teaches the thing traders lack: confidence should match accuracy. Without a proper rule the learner could game the score (always say 99%).

## Plain-language explanation
A forecast is a probability `p` that an event happens (here: the close `h` bars ahead is higher than today's close). The outcome `y` is 1 if it happened and 0 if not. The **Brier score** of one forecast is `(p - y)^2`; the score of a set is the mean. Lower is better.

Example: forecasts 0.9, 0.8, 0.3, 0.6 and outcomes 1, 0, 0, 1 give squared errors 0.01, 0.64, 0.09, 0.16; the mean is **0.225**. Always saying 0.5 gives exactly **0.25** whatever happens, so 0.225 beats a coin flip by a little. The **skill score** against the coin flip is `1 - 0.225 / 0.25 = 0.10`.

A scoring rule is **strictly proper** if the best expected score comes only from reporting your true belief. The Brier score and the logarithmic score are both proper; "percent correct" is not (it ignores confidence). **Log loss** is `-(y ln p + (1-y) ln(1-p))`, which explodes at `p = 0` or `1`, so MarketLab restricts `p` to [0.01, 0.99].

**Tie rule (a documented convention):** `y = 1` only if the later close is strictly higher; an equal close counts as 0.

## Key terms
- forecast / outcome: stated probability `p` and what happened `y` (0 or 1).
- Brier score: mean of `(p - y)^2`, range 0 (perfect) to 1 for binary events; coin flip = 0.25.
- skill score: `1 - BS / BS_reference`; positive means better than the reference.
- proper scoring rule: one that rewards honest probabilities.
- log loss: logarithmic score; harsher on confident mistakes.
- base rate: how often the event happens in general (for daily US equity closes the share of up days is a little above one half; for a pure random walk without drift it is one half).

## Common mistakes / pitfalls
- Reporting accuracy only ("I was right 6 of 10"): a 51% guess and a 99% guess look alike.
- Comparing Brier scores across different base rates without a reference (a constant forecast of the base rate already scores `ybar (1 - ybar)`).
- Clipping inconsistently (score with a different `p` than the one stored).
- Treating overlapping horizons as independent (a 10-bar-ahead question asked every day shares most of its outcome with its neighbours).

## What to implement in this domain
- `brier`, `log_loss`, `skill_score` as pure functions on lists of `(p, y)`; `p` validated in [0.01, 0.99], `y` in {0, 1}.
- Baselines shown beside the score: coin flip (0.25) and constant base rate of the learner's own resolved outcomes (this one is in-sample and therefore flattering; say so).
- Hand-computable golden tests (the 0.225 example above) and a property test that a forecaster who reports their true probability does not score worse on average than one who exaggerates.

## How to check you understood
1. Brier score of forecasts 0.5, 0.5, 0.5? (0.25 whatever the outcomes.)
2. Forecast 0.99, outcome 0: Brier and log loss? (0.9801; log loss `-ln(0.01) = 4.605`.)
3. Why is accuracy not proper? (Saying 99% instead of your honest 60% scores the same accuracy; a proper rule punishes the exaggeration.)

## References
- [Wikipedia: Brier score](https://en.wikipedia.org/wiki/Brier_score): definition, range, reliability-resolution-uncertainty split (read 2026-11-09).
- [Wikipedia: Scoring rule](https://en.wikipedia.org/wiki/Scoring_rule): why strictly proper rules reward honest reports (read 2026-11-09).
- Brier (1950), "Verification of forecasts expressed in terms of probability", Monthly Weather Review 78(1), DOI 10.1175/1520-0493(1950)078<0001:VOFEIT>2.0.CO;2 (unverified): the original definition (note its original form ranges 0 to 2).
- [scikit-learn `brier_score_loss`](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.brier_score_loss.html) (unverified deep link): a reference implementation to compare against.
