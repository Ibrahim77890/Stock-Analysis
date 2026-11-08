# Luck controls: bootstrap, random-walk controls and the shuffle test

**Sprint:** 03    **Used by tasks:** 03_07, 03_08

## Why this matters for MarketLab
One backtest is one draw. "Is this luck, bias, or a real edge?" (blueprint 23.1) can only be asked by running the same strategy on data where no edge can exist and seeing how often it does just as well. This is the first honest uncertainty tool in the product.

## Plain-language explanation
**Block bootstrap.** Cut the real series into blocks of L consecutive bars (say 20), draw blocks at random with replacement and glue them into a new path of the same length. Each bar keeps its own internal shape (its gap, range and close relative to its open), and short-range structure inside a block survives, but any long-range ordering (a trend lasting a year) is destroyed. The path keeps the asset's average drift, so the control asks "does the rule exploit order, or does it just ride drift?".

**Random-walk control (GBM).** Simulate prices with the same mean and volatility of daily log returns as the real series but independent returns: no memory exists by construction. Seed the random generator so the control is reproducible.

**Reading the result.** Run N = 200 synthetic paths with the same strategy and costs. Report the distribution of total return and Sharpe, the real result's percentile in it, and the fraction of synthetic runs at least as good (a rough one-sided p-value; N is small and not independent of the choices made, so treat it as a teaching aid, not a test of significance).

Example: the real Sharpe is 0.8; 31% of 200 random paths score >= 0.8. The strategy's apparent edge is weak evidence.

## Key terms
- bootstrap: resampling data with replacement to estimate variability.
- block length: how many consecutive bars are kept together.
- seed: the number that fixes a pseudo-random sequence so a run is reproducible.
- control / null model: data where the effect being tested cannot exist.
- percentile rank: share of control results below the real result.

## Common mistakes / pitfalls
- Shuffling individual bars (L = 1) and claiming it keeps volatility clustering (it does not).
- Using an unseeded generator (non-reproducible), or reseeding every path with the same seed (identical paths).
- Reading p = 0.04 as proof; many parameters tried makes small p-values common by chance.
- Mixing up "drift preserved" (bootstrap) with "drift removed" (a demeaned control; state which one you run).
- Resampling prices instead of returns (creates fake jumps at the seams).

## What to implement in this domain
- `shuffle_test(...)` with `method` in `block_bootstrap` | `gbm`, `n_paths`, `block_length`, `seed`.
- Synthetic OHLC must pass the Sprint 01 OHLC sanity rules (high >= max(open, close), low <= min(open, close), positive prices).
- Output: per-path total return and Sharpe, quantiles (5, 25, 50, 75, 95), real result percentile, fraction >= real, and the seed and method used.
- Same seed and inputs give identical output (reproducibility invariant).

## How to check you understood
1. Why can a bootstrap preserve drift but not trends? (Blocks keep local returns; their order is random.)
2. With the same seed twice, should results be identical? (Yes; that is the reproducibility invariant.)
3. Fraction of random runs >= real result is 0.6. What does it suggest? (The result is typical of luck.)

## References
- [Wikipedia: Bootstrapping (statistics)](https://en.wikipedia.org/wiki/Bootstrapping_(statistics)): idea of resampling (verified reachable).
- [NumPy: random Generator](https://numpy.org/doc/stable/reference/random/generator.html): seeded, reproducible random numbers (verified reachable).
- [Wikipedia: Geometric Brownian motion](https://en.wikipedia.org/wiki/Geometric_Brownian_motion): the random-walk model (verified reachable).
- [Bailey, Borwein, Lopez de Prado, Zhu: Pseudo-Mathematics and Financial Charlatanism](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2308659) (unverified: the site blocks automated checks): why optimised backtests overfit.
