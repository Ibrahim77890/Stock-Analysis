# Overconfidence, luck and the permutation check

**Sprint:** 06    **Used by tasks:** 06_04, 06_05, 06_10

## Why this matters for MarketLab
A learner who scores 0.22 on 25 predictions will feel skilled. The honest question is: how often would *random* forecasting of the same kind do that well? This is the learning-loop version of the Sprint 03 shuffle test and the Sprint 04 best-of-N control: the product teaches the learner to distrust a short good streak.

## Plain-language explanation
**Overconfidence** is stating more certainty than your accuracy supports. Retail trading data show that more activity and more confidence tend to go with worse results, not better ones (see the Barber and Odean reference), which is why MarketLab measures confidence separately from direction.

**Permutation check.** Keep the learner's stated probabilities exactly as they are, but shuffle which outcome each one is attached to, many times (for example 5,000 seeded shuffles). Each shuffle is a "forecaster with the same habits and no information". The share of shuffles that score at least as well as the real score is the **luck probability** `(1 + count) / (B + 1)`. If 4,000 of 5,000 shuffles score as well as you did, your result is ordinary; if 20 of 5,000 do, it is unusual.

Example: 40 predictions, real Brier 0.236. In 5,000 shuffles, 1,950 score 0.236 or better: luck probability about 0.39. Not evidence of skill. With 400 predictions and the same score the shuffles would almost never match it, and the same number would mean something.

**Pure-noise episodes.** Some episodes are seeded random walks. On them no honest forecaster can beat 0.25 on average; a learner who is confident there (probabilities far from 0.5) should score *worse* than 0.25. Showing the score split by real and synthetic episodes makes "pattern-finding in noise" visible.

**Limits.** Outcomes of overlapping horizons are dependent, so the effective sample is smaller than the count, and a permutation treats outcomes as exchangeable; say so next to the number.

## Key terms
- overconfidence: confidence above accuracy.
- permutation check / test: comparing a statistic with its distribution when labels are shuffled.
- luck probability: share of shuffles scoring at least as well, with the observed score counted once.
- exchangeable: shuffling labels does not change the situation under "no skill".
- effective sample size: how many independent observations the data are worth.

## Common mistakes / pitfalls
- Reporting "p = 0.0" (always add 1 to numerator and denominator).
- Running the check on fewer than about 30 resolved forecasts and presenting the result.
- Pooling horizons without saying that nearby outcomes overlap.
- Re-rolling the shuffle seed until it looks good: fix the seed and show it.
- Treating a good score on the learner's own base rate as skill: the in-sample base-rate baseline is flattering.

## What to implement in this domain
- `permutation_luck(forecasts, outcomes, n_perm=5000, seed=1)` returning real score, shuffled quantiles, count and luck probability; deterministic for a seed; shuffles within each horizon.
- Score split by episode kind (real, synthetic) after the reveal.
- A visible "too few predictions" state and a caution about overlapping horizons.

## How to check you understood
1. Why shuffle outcomes and not forecasts? (Both are equivalent; shuffling one breaks the link between them and keeps each marginal distribution.)
2. 99 of 999 shuffles score at least as well as you. Luck probability? ((1 + 99) / (999 + 1) = 0.10.)
3. Why can a confident learner score below 0.25 on a random-walk episode? (Confident guesses are right half the time but punished hard when wrong.)

## References
- [Wikipedia: Permutation test](https://en.wikipedia.org/wiki/Permutation_test): method and the Monte Carlo variant (read 2026-11-09; it does not state the `(1+count)/(B+1)` formula, which is the standard way to avoid a zero p-value).
- [Wikipedia: Overconfidence effect](https://en.wikipedia.org/wiki/Overconfidence_effect): definition and calibration studies (read 2026-11-09).
- Barber and Odean (2000), "Trading is hazardous to your wealth: the common stock investment performance of individual investors", Journal of Finance 55(2), DOI 10.1111/0022-1082.00226 (unverified: the DOI redirects to the publisher page, which was not read).
- [Wikipedia: Base rate](https://en.wikipedia.org/wiki/Base_rate): why the prior frequency matters (read 2026-11-09).
