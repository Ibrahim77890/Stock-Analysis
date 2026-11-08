# How uncertain is a Sharpe ratio? Probabilistic and deflated Sharpe

**Sprint:** 04    **Used by tasks:** 04_05, 04_06

## Why this matters for MarketLab
A Sharpe ratio estimated from a few years of data has a wide error bar, and the best of many trials is biased upward. The probabilistic Sharpe ratio (PSR) says how likely the true Sharpe is above a threshold given sample length and return shape; the deflated Sharpe ratio (DSR) sets that threshold to the Sharpe a no-skill search would be expected to reach by luck. This is the "overfitting meter" of blueprint 23.2.

## Plain-language explanation
Use **per-period** (daily, not annualised) Sharpe `SR` for the formulas. With `T` returns, skewness `g3` and kurtosis `g4` (non-excess; 3 for a normal distribution):

`PSR(SR*) = Phi( (SR - SR*) * sqrt(T - 1) / sqrt(1 - g3*SR + ((g4 - 1)/4) * SR^2) )`

where `Phi` is the standard normal cumulative distribution function. Example: annualised Sharpe 1.0 over `T = 1000` daily returns, normal returns: `SR = 1/sqrt(252) = 0.0630`, the denominator is about 1.001, the numerator is `0.0630 * sqrt(999) = 1.991`, so `PSR(0)` is about `Phi(1.99) = 0.977`. With `T = 250` the same `SR` gives `0.0630 * sqrt(249) = 0.994` and `PSR(0)` is about 0.84: one year of data is far from convincing.

**Deflation.** If `N` trials had Sharpe estimates with variance `V`, the expected maximum under no skill is approximately

`SR0 = sqrt(V) * ( (1 - gamma) * Phi^-1(1 - 1/N) + gamma * Phi^-1(1 - 1/(N*e)) )`

with `gamma = 0.5772...` (Euler-Mascheroni) and `Phi^-1` the inverse normal CDF; define `SR0 = 0` for `N = 1`. Then `DSR = PSR(SR0)`. A DSR near 1 means the winner is unlikely to be explained by the number of tries; a DSR near 0.5 or lower means it is.

This is a **model-based approximation** that assumes independent trials with the same variance; correlated neighbouring pairs lower the effective `N`. Treat the output as a warning light, not a verdict.

## Key terms
- per-period Sharpe: mean divided by standard deviation of returns at the data frequency.
- skewness / kurtosis: asymmetry and tail heaviness of returns.
- PSR: probability that the true Sharpe exceeds a threshold.
- DSR: PSR evaluated at the expected best-of-N Sharpe under no skill.
- effective number of trials: independent-tries equivalent of the search.

## Common mistakes / pitfalls
- Plugging an annualised Sharpe into the formula (it needs the per-period value and the matching `T`).
- Using excess kurtosis where the formula needs plain kurtosis (difference of 3).
- Taking `V` from one trial instead of the cross-trial variance of Sharpe estimates.
- Treating DSR as a probability that the strategy is profitable in the future.
- Forgetting that the registry may undercount the true number of trials (ideas tried on paper, other datasets).

## What to implement in this domain
- `probabilistic_sharpe(returns, benchmark_sr=0)` and `expected_max_sharpe(n_trials, variance)` and `deflated_sharpe(returns, trials)` using only the standard library (`statistics.NormalDist`) and NumPy.
- Return `None` with a reason when `T < 30` or the denominator is not positive.
- An "overfitting meter" summary for a study: N trials, best IS Sharpe (annualised and per period), SR0, DSR.
- Tests against independently coded numbers (the worked example above), properties (DSR falls as N rises; PSR rises with `T`), and a Monte Carlo check that with no skill and N trials the share of studies with DSR above 0.95 is small.

## How to check you understood
1. Why must SR in the formula be per-period? (`sqrt(T - 1)` counts periods at that frequency.)
2. `N = 1` trial: what is SR0 and what does DSR equal? (0, and PSR(0).)
3. Why does fatter-tailed or negatively skewed return data lower PSR? (The denominator grows, so the same SR is less certain.)

## References
- [Bailey and Lopez de Prado, The Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) (unverified: the site blocks automated checks): the PSR/DSR formulas and derivation.
- [Sharpe, The Sharpe Ratio (1994)](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm): the base definition.
- [Python statistics.NormalDist](https://docs.python.org/3/library/statistics.html): `cdf` and `inv_cdf` used for Phi and its inverse.
- [Wikipedia: Skewness](https://en.wikipedia.org/wiki/Skewness) and [Kurtosis](https://en.wikipedia.org/wiki/Kurtosis): the moments in the formula (note excess vs plain).
- [Wikipedia: Euler-Mascheroni constant](https://en.wikipedia.org/wiki/Euler%E2%80%93Mascheroni_constant): the constant gamma.
