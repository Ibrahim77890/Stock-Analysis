# Trying many ideas: overfitting and the number of tries

**Sprint:** 07    **Used by tasks:** 07_02, 07_04, 07_06

## Why this matters for MarketLab
The Strategy Lab invites experiments: change the numbers, run again. Every run is another ticket in a lottery. The best result among 30 tries is biased upward even if every idea is worthless. MarketLab already counts tries (the trial registry, Sprint 04); the lab must show that count to the learner next to every "best" number.

## Plain-language explanation
**Overfitting** means fitting the noise of the past instead of something that repeats. With a rule that has two numbers (a short and a long average length) there are hundreds of combinations; some will look good on any history by luck alone. This is the **multiple comparisons problem**: the more things you test, the more likely one looks special by chance.

Example: flip 20 fair coins 10 times each. The best coin may show 8 heads out of 10. That coin is not special; it was the best of 20. A rule picked as the best of 30 tries is the same.

The **deflated Sharpe ratio** (DSR) asks: given how many tries were made, how likely is it that the best result is better than the best you would expect from tries with no skill at all? In words the lab says: "You have tried 12 ideas. With that many tries, a result this good happens by luck about X% of the time." The number of tries is a **lower bound**: ideas tried in your head or elsewhere are not counted.

## Key terms
- overfitting: matching noise in past data.
- multiple comparisons: testing many ideas raises the chance that one looks good by luck.
- trial: one run of one idea (one pair of numbers).
- study: one learner's project on one stock; it counts its trials.
- deflated Sharpe ratio: a result adjusted for the number of tries.
- data dredging: searching until something looks significant.

## Common mistakes / pitfalls
- Reporting only the best run and forgetting how many were made.
- Treating neighbouring settings (10/50 and 11/50) as independent tries: they are nearly the same idea, so the count overstates independence (say so).
- Changing the rule after seeing the final test result (that is one more try).
- Believing a deflated score proves a rule works; it only says whether luck is a cheap explanation.

## What to implement in this domain
- Every lab run is recorded as a trial in the learner's study (append-only), including the poor ones.
- The workbench shows "ideas tried" at all times, and when at least two tries exist, the overfitting meter in plain words, with the caveat that the count is a lower bound.
- Hard caps on tries per study so the registry cannot be used as a free compute service.

## How to check you understood
1. Why is the best of 20 tries not comparable to a single try? (It is the maximum of 20 draws, which is larger on average than one draw.)
2. A learner tried 3 ideas and another tried 60. Who should trust a good result less? (The second, all else equal.)
3. Why is "ideas tried" only a lower bound? (Ideas tested elsewhere or on paper are not in the registry.)

## References
- [Wikipedia: Overfitting](https://en.wikipedia.org/wiki/Overfitting): definition and examples (read earlier, Sprint 04).
- [Wikipedia: Multiple comparisons problem](https://en.wikipedia.org/wiki/Multiple_comparisons_problem): why many tests inflate false positives (read earlier, Sprint 04).
- [Wikipedia: Data dredging](https://en.wikipedia.org/wiki/Data_dredging): the practice and its names (read earlier, Sprint 04).
- [Bailey and Lopez de Prado, The Deflated Sharpe Ratio](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551) (unverified: the site blocks automated checks): the formula MarketLab implements.
- MarketLab `docs/02-domain/validation.md` and ADR 0012: how trials and the overfitting meter work.
