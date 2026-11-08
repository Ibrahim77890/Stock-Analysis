# Overfitting, data snooping and multiple testing

**Sprint:** 04    **Used by tasks:** 04_01, 04_02, 04_05

## Why this matters for MarketLab
Sprint 03 can score one parameter pair. The moment a learner tries 20/50, then 10/40, then 5/30, the best of those is a biased number: the more pairs tried, the better the best one looks even on pure noise. MarketLab's thesis is to teach distrust of results, so every parameter search must count its own trials and show the penalty.

## Plain-language explanation
**Overfitting** means a rule is tuned to the quirks of one dataset, so it looks good there and fails on new data. **Data snooping** (data dredging) is trying many ideas on the same data and reporting the winner. **Multiple testing** is the statistical name: with many tries, a lucky result is expected.

Example: suppose 100 useless strategies each have a 5-year annualised Sharpe that is random with mean 0 and standard deviation about 0.45 (roughly 1 divided by the square root of 5 years). The expected best of 100 normal draws is about 2.5 standard deviations, so the "winner" shows a Sharpe near 1.1 although every strategy has no edge. A learner who reports only the winner has not discovered anything.

The defence is bookkeeping and honesty: record every trial (a **trial registry**), report the number of trials next to the winner, split the data so the winner is judged on data it never saw (concept 04_02), and deflate the Sharpe ratio for the number of trials (concept 04_04).

## Key terms
- trial: one evaluated configuration (a parameter pair on a window).
- study: a group of trials made in one search by one person on one dataset.
- grid search: evaluating every pair in a list of values.
- in-sample (IS): data used to choose parameters.
- selection bias: the winner of many tries is better than its true quality.
- effective number of trials: how many independent tries the search is worth (nearby parameter pairs are correlated, so this is usually below the raw count).

## Common mistakes / pitfalls
- Not counting the failed tries, or counting only the ones saved.
- Re-running the same search after seeing the test result and calling it the first try.
- Treating neighbouring parameter values as independent evidence of robustness.
- Reporting the best IS Sharpe as if it were a forecast.
- (Interpretation, debated) Believing that a smooth performance "plateau" in parameter space proves an edge; it is weak evidence at best.

## What to implement in this domain
- A registry in the `research` schema where each trial of a study is stored (family, symbol, window, parameters, metrics, phase train/test/holdout).
- A grid search that writes one trial per evaluated pair, on the training window only.
- A report line: "N trials, best IS Sharpe x, expected best-of-N under no skill y."
- Where the project owner keeps it: same module family as `research.py`; record names in the status log.

## How to check you understood
1. You test 30 parameter pairs and keep the best. How many trials do you report? (30, plus any earlier ones on the same data.)
2. Why is the best of 100 random strategies not a discovery? (Its high value is what you expect from the maximum of 100 noisy numbers.)
3. Why do 20/50 and 21/50 count as less than two independent trials? (Their results are highly correlated.)

## References
- [Wikipedia: Overfitting](https://en.wikipedia.org/wiki/Overfitting): definition and examples.
- [Wikipedia: Multiple comparisons problem](https://en.wikipedia.org/wiki/Multiple_comparisons_problem): why many tests inflate false positives.
- [Wikipedia: Data dredging](https://en.wikipedia.org/wiki/Data_dredging): the practice and its names.
- [Bailey, Borwein, Lopez de Prado, Zhu: Pseudo-Mathematics and Financial Charlatanism](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2308659) (unverified: the site blocks automated checks): backtest overfitting in finance.
