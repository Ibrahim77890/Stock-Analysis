# Long history: what a longer window changes and what it does not

**Sprint:** 05    **Used by tasks:** 05_04, 05_09

## Why this matters for MarketLab
Sprint 04 validated on 5.4 years that contain one bull market, the 2022 drawdown and little else; blocks held 1 to 5 trades. A twenty-year window includes the 2008 crisis, the 2020 crash and several calm and turbulent periods, which gives validation tools something to work with. It also tempts the reader to believe the question is now settled. It is not.

## Plain-language explanation
More data narrows the error bar of a Sharpe ratio roughly with the square root of the number of years: a standard error of about `1/sqrt(years)`, so 5.4 years gives about 0.43 and 20 years about 0.22. It does **not** remove: selection bias (trial count still matters), survivorship (today's survivors only), regime dependence (rules can work in one era), and the fact that the 20 years are one path of history.

Specific hazards when extending history:
- **Source change.** Windows before 2020-07-27 exist only in the second source; the long series must come from one source to avoid a seam. Use the second source for the whole long window and compare with the first on the overlap.
- **Survivorship grows with time.** The farther back, the more companies from that era have gone; the current-day universe is even less representative.
- **Corporate actions accumulate.** More splits and dividends, more chances for a vendor error; the reconciliation and external adjustment checks matter more.
- **Structural change.** Decimalisation, algorithmic trading and the ETF boom change market behaviour; "20 years" is not one regime.

Example: with 20 years, a Sharpe estimate of 0.5 has a standard error near 0.22, so roughly 2.3 standard errors from zero before any deflation for the number of trials tried.

## Key terms
- standard error of Sharpe: approximate uncertainty `1/sqrt(years)` (rule of thumb for roughly independent returns).
- seam: a discontinuity where two sources are joined.
- era / regime: a period with distinct market structure or behaviour.
- survivorship: only securities that exist today are present.

## Common mistakes / pitfalls
- Joining two sources into one series.
- Reading a longer window's smaller error bar as removing the need to count trials.
- Reporting a full-period result without the by-year/regime table.
- Comparing results from different windows as if they were the same experiment.
- Forgetting that the free vendor's history may start later for newer listings (check each symbol).

## What to implement in this domain
- Run Sprint 04's validation (split, walk-forward, DSR, scan, regimes) on the long window from the second source, and put the numbers next to the 5.4-year ones.
- A table of the longest available start date per symbol (from the vendor's metadata or the loaded data) and the number of symbols that cover the full window.
- Regime tables by year and by VIX bucket that include 2008 and 2020.
- A paragraph stating what changed in the conclusions and what did not.

## How to check you understood
1. Roughly how much smaller is the Sharpe standard error at 20 years than at 5? (Half: 1/sqrt(20) vs 1/sqrt(5).)
2. Why not splice Alpaca after Tiingo to get a longer series? (A seam: different feeds, volume and prices; comparisons across it are not like with like.)
3. Does a longer window reduce the multiple-testing penalty? (No; it depends on the number of trials, though a longer sample makes the deflation threshold relatively smaller.)

## References
- [Sharpe, The Sharpe Ratio (1994)](https://web.stanford.edu/~wfsharpe/art/sr/sr.htm): estimation and interpretation.
- [Wikipedia: Survivorship bias](https://en.wikipedia.org/wiki/Survivorship_bias): the effect lengthens with the window.
- [Bailey and Lopez de Prado, The Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) (unverified: the site blocks automated checks): sample length and trials.
- Project: `docs/02-domain/validation-worked-example.md` (the 5.4-year baseline).
