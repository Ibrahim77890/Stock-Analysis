# Selection bias: best of N symbols, and survivorship

**Sprint:** 04    **Used by tasks:** 04_06

## Why this matters for MarketLab
Running one strategy over 53 symbols and showing the top three is a search too: the symbol is a parameter. In addition, the 53 symbols are today's large, liquid survivors, so even the average result is flattered. Learners should see both effects with numbers from the data MarketLab actually holds.

## Plain-language explanation
**Best of N.** Evaluate the same rule on N symbols. Even if the rule has no skill, the maximum Sharpe over N symbols is positive and grows with N. With 53 symbols, each with a Sharpe-estimate spread of roughly 0.43 (about 1 divided by the square root of 5.4 years of data), the expected maximum of 53 normal draws is about 2.3 spreads, around 1.0. A "best symbol Sharpe of 1.0" is therefore unremarkable.

**Control.** For each of R replicates, simulate one random-walk path per symbol (each with that symbol's own mean and volatility, as in the Sprint 03 GBM control), run the rule, and record the maximum Sharpe across the N paths. The real maximum is then ranked among the R simulated maxima. This compares like with like: best-of-N against best-of-N.

**Survivorship bias** is the reverse side: the universe only contains names that exist today, so failures (delistings) are missing. Many free datasets cannot fix this; the right behaviour is to say so on the result, not to hide it. This sprint attaches a visible caveat; building a delisted-names demo (for example from the Nasdaq WIKI archive, blueprint 25.1) is deferred.

## Key terms
- best of N: the maximum of N results, a biased estimate of any single one.
- cross-section: the set of symbols evaluated for the same rule and period.
- survivorship bias: omission of securities that stopped trading.
- universe caveat: the badge that tells the reader which symbols were included and why.

## Common mistakes / pitfalls
- Showing only the best symbol and not N.
- Comparing the real best against a single simulated path instead of the best of N simulated paths.
- Ignoring that symbols are correlated (the 12 ETFs overlap many stocks), which lowers the effective N.
- Treating survivors' average result as the market's.

## What to implement in this domain
- `universe_scan(conn, spec, symbols)`: run the strategy on every symbol with enough bars, return per-symbol metrics, the distribution (quantiles) and the symbol count used.
- `best_of_n_control(...)`: R replicates of N seeded GBM paths, the distribution of the maximum Sharpe, the real maximum's rank.
- Result fields: N, symbols skipped (too few bars) with reason, the universe caveat text.
- Tests: reproducible with the seed; the max over N is non-decreasing in N on a fixed set of paths; a short-history symbol is skipped with a reason; an unknown symbol is rejected.

## How to check you understood
1. Why compare the real best-of-53 with simulated best-of-53 rather than with one path? (The maximum of 53 is biased upward; only a maximum is comparable.)
2. Does a high average Sharpe across the survivors prove the rule works on the market? (No; the universe excludes failures.)
3. Why is the effective N below 53? (Symbols are correlated.)

## References
- [Wikipedia: Selection bias](https://en.wikipedia.org/wiki/Selection_bias): the general phenomenon.
- [Wikipedia: Survivorship bias](https://en.wikipedia.org/wiki/Survivorship_bias): the finance example.
- [Investor.gov: Survivorship bias](https://www.investor.gov/introduction-investing/investing-basics/glossary/survivorship-bias): regulator-hosted definition (reachable when checked).
- [Wikipedia: Extreme value theory](https://en.wikipedia.org/wiki/Extreme_value_theory): why maxima of many draws behave differently from single draws.
