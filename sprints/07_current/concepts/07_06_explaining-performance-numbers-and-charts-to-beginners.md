# Explaining performance numbers and charts to beginners

**Sprint:** 07    **Used by tasks:** 07_01, 07_05, 07_06, 07_07, 07_08

## Why this matters for MarketLab
Total return, CAGR, Sharpe ratio, drawdown and exposure are all correct and all confusing. A beginner who misreads "Sharpe 0.57" or sees a line that looks steady because of the scale will draw the wrong lesson. The lab is judged by whether a newcomer can say, after one run, what happened and what it does not show.

## Plain-language explanation
Show few numbers, each with a sentence, and the benchmark beside every one.
- **Growth of 100** (equity curve): "100 became 187." Draw both lines on one chart, same start at 100.
- **Total return**: the change over the whole window ("up 87%"); **per year** (CAGR) spreads it evenly so windows of different length can be compared ("about 3.5% a year").
- **Worst fall** (maximum drawdown): the largest drop from a peak ("at one point you were down 28% from your best").
- **Time in the stock** (exposure): "invested 56% of days".
- **Trades**: how many buys; with fewer than about 20, say "too few to learn much".
- **Sharpe ratio** (optional, behind "Show more"): return per unit of ups and downs; above zero means more reward than risk-free cash for the risk taken; compare with buy and hold, not with a magic threshold.
- **Costs**: show the same rule at several cost levels as a small table, so "it stops working at 5 bps" is visible.

**Chart choices.** Start both lines at 100. Use a **log scale** for 20-year charts, so equal percent moves look equal (on a plain scale the late years dominate); label the axis ("Growth of 100 (log scale)"). Colour is never the only signal: label the lines and use different dash styles. Provide a text table with yearly values as the accessible alternative.

**Words that mislead.** Avoid "beats the market", "edge", "profit" and "alpha". Write "in this sample", "in these years", "after costs".

## Key terms
- growth of 100: equity curve scaled to start at 100.
- CAGR: compound annual growth rate, the steady yearly rate that gives the same end value.
- maximum drawdown: the largest peak-to-trough fall.
- exposure: share of days invested.
- log scale: an axis where equal percentage changes have equal height.
- benchmark: the thing to compare with (buy and hold).

## Common mistakes / pitfalls
- Showing the rule's return without the benchmark.
- Mixing "per year" numbers and "total" numbers in one sentence.
- A chart that does not start both lines at the same value.
- Hiding the drawdown behind a nice return.
- Sentences that sound like advice.

## What to implement in this domain
- A fixed set of result cards: growth of 100 chart, three headline numbers (total return, worst fall, trades) for the rule and buy and hold, a cost table, a luck panel, ideas tried, with copy in `src/copy` checked for reading ease.
- A log-scale equity chart with labelled lines and a yearly table as text alternative.
- A "What this does not tell you" list on every result.

## How to check you understood
1. 100 became 250 in 10 years. Roughly the yearly rate? (About 9.6% a year: 2.5^(1/10) - 1.)
2. A rule returns 60% and had a 55% worst fall; buy and hold returned 70% with a 30% fall. Which would you describe as better, and why careful? (Neither clearly; the rule earned less with a bigger fall; one window is one sample.)
3. Why a log axis for 20 years? (So a 10% move in year 3 looks as big as a 10% move in year 18.)

## References
- [Wikipedia: Compound annual growth rate](https://en.wikipedia.org/wiki/Compound_annual_growth_rate): formula (read earlier, Sprint 03).
- [Wikipedia: Maximum drawdown](https://en.wikipedia.org/wiki/Maximum_drawdown): definition (read 2026-11-09).
- [Wikipedia: Sharpe ratio](https://en.wikipedia.org/wiki/Sharpe_ratio): formula and caveats (read earlier, Sprint 03).
- [Wikipedia: Logarithmic scale](https://en.wikipedia.org/wiki/Logarithmic_scale): why growth is often drawn on a log axis (read 2026-11-09; it does not mention stock prices specifically).
- [Lightweight Charts documentation](https://tradingview.github.io/lightweight-charts/docs): line series and price scale modes, including logarithmic (read earlier, Sprint 06).
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): text alternatives and use of colour (read earlier, Sprint 06).
- MarketLab `docs/02-domain/backtest.md` (metric definitions) and concept 06_08 (plain language and light theme).
