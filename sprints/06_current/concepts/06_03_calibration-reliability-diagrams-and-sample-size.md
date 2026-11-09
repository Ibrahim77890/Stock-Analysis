# Calibration, reliability diagrams and sample size

**Sprint:** 06    **Used by tasks:** 06_04, 06_05, 06_10

## Why this matters for MarketLab
A single Brier number cannot say *how* a learner is wrong. A reliability diagram shows whether "70% sure" really came true about 70% of the time, and the sample size tells how much of the picture is noise. With 20 predictions most bins hold 1 to 3 points, so an honest app must say "too few to tell".

## Plain-language explanation
**Calibration** means that among all forecasts of about `p`, a fraction about `p` came true. Group forecasts into bins (0.0-0.1, 0.1-0.2, ..., 0.9-1.0). For each bin compute the number of forecasts `n`, the mean forecast and the observed frequency. Plot observed against mean forecast: points on the diagonal are calibrated; points below it on the right side are **overconfidence**.

Example: in the bin 0.7-0.8 the learner made 10 forecasts (mean 0.75) and 5 came true: observed 0.50. That looks overconfident, but with `n = 10` the **Wilson 95% interval** for 5/10 is about 0.24 to 0.76, which still contains 0.75. The data cannot yet show overconfidence.

**Murphy's decomposition** splits the Brier score: `BS = REL - RES + UNC`. `REL` (reliability) is how far the bin means are from the observed frequencies (lower is better); `RES` (resolution) is how much the forecasts separate the outcomes (higher is better); `UNC = ybar (1 - ybar)` is the difficulty of the questions. It is exact when forecasts are constant inside each bin and approximate otherwise.

## Key terms
- calibration / reliability diagram: observed frequency vs forecast probability by bin.
- Wilson interval: a confidence interval for a proportion that behaves sensibly at small `n` and near 0 or 1.
- reliability (REL), resolution (RES), uncertainty (UNC): the three Brier components.
- sparse bin: fewer than 5 forecasts; shown but marked, never used for a claim.
- overconfidence: stated confidence above the observed hit rate.

## Common mistakes / pitfalls
- Drawing a smooth line through 10 points and reading a trend.
- Showing bins without their counts or intervals.
- Using the normal-approximation interval at small `n` or at 0 and 1 (it can leave [0, 1]).
- Concluding anything from fewer than about 30 resolved forecasts in total.

## What to implement in this domain
- `calibration_bins(forecasts, outcomes, width=0.1)` returning, per bin, `n`, mean forecast, observed frequency, Wilson lower/upper; empty bins returned with `n = 0` and no frequency.
- `murphy_decomposition(...)` with a test of the identity on forecasts that are constant within bins.
- A "too few predictions" rule: below 30 resolved forecasts no skill or calibration statement is made; bins with `n < 5` carry a "sparse" flag.

## How to check you understood
1. Wilson interval for 0 successes of 5? (It is not zero-width: roughly 0 to 0.43.)
2. If all forecasts are exactly 0.5, what are REL, RES, UNC? (REL is `(0.5 - ybar)^2`, RES is 0, UNC is `ybar (1 - ybar)`; BS = 0.25.)
3. Why is a 10-point bin not evidence of overconfidence even when it sits below the diagonal? (Its interval is wide and still includes the diagonal.)

## References
- [scikit-learn: Probability calibration](https://scikit-learn.org/stable/modules/calibration.html): calibration curves and reliability diagrams (read 2026-11-09).
- [Wikipedia: Binomial proportion confidence interval](https://en.wikipedia.org/wiki/Binomial_proportion_confidence_interval): the Wilson score interval (read 2026-11-09; the formula in the fetched text was garbled, check it against the article).
- [Wikipedia: Brier score](https://en.wikipedia.org/wiki/Brier_score): the reliability/resolution/uncertainty decomposition.
- Murphy (1973), "A new vector partition of the probability score", Journal of Applied Meteorology 12, 595-600 (unverified): the decomposition.
