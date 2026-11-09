# The vault: out-of-sample data, holdout and one-use tests

**Sprint:** 07    **Used by tasks:** 07_02, 07_03, 07_04, 07_07, 07_08

## Why this matters for MarketLab
The honest answer to "does my rule work?" comes from data it was never tuned on. If a learner can test on the same years again and again, those years stop being a test. The lab hides the **last years of each stock's history** in a **vault**: practice runs see only the earlier years, and the vault opens **once** per study. This turns Sprint 04's validation ideas into something a beginner can feel.

## Plain-language explanation
**In-sample** data are the years you look at while choosing a rule. **Out-of-sample** data come later and were not used to choose. A **holdout** is a block of out-of-sample data kept aside until the end. Using it **once** is the point: after you have seen its result and changed your rule, it has become practice data.

How the lab works: each stock's history (about 21 years for most symbols) is split in time: roughly the first 17 years are the **practice window**; the last 4 are the **vault**. Practice runs use only the practice window; their prices are adjusted as of the practice window's last day, so nothing from the vault leaks in. When the learner chooses "Test it for real", the lab runs the chosen rule on the vault **once**, shows the result next to the practice result, and locks the vault for that study. A rule must also warm up: the first bars of the vault test may use earlier practice prices to compute averages (past data may feed indicators; future data may not).

Example: a rule makes 70% in practice and 2% in the vault. That gap is the lesson: in-sample results flatter.

## Key terms
- practice window: the early years the learner may use freely.
- vault (holdout): the last years, hidden until the one-time test.
- in-sample / out-of-sample: data used to choose / data not used.
- one-use: after the vault is opened, the study cannot open it again.
- warm-up: earlier bars used only to compute averages at the start of a test.
- leakage: any way vault information reaches practice results.

## Common mistakes / pitfalls
- Letting any practice number depend on vault bars (adjusted prices computed with the whole history, a "total return" that includes later dividends, a date range echoed in an error message).
- Letting the learner reopen the vault by creating a new study on the same stock without that being visible (a new study is allowed but its tries start from zero; the lab says the vault was already seen by this learner for that stock).
- Choosing the vault length so small that it holds only a few trades.
- Presenting the vault result as a forecast.

## What to implement in this domain
- A fixed split per stock (practice end date stored on the study); practice bars are loaded with an end date equal to the practice end, so adjustment is as of that date.
- A one-use vault evaluation reusing the Sprint 04 holdout rule (`HoldoutAlreadyUsedError`, HTTP 409), with the learner's rule fixed before the call and shown in the confirmation.
- Tests that deleting all vault data leaves every practice result unchanged, and that no practice response contains a date after the practice end.

## How to check you understood
1. Why adjust practice prices as of the practice end and not as of today? (Adjustment uses later splits and dividends; using today's date would feed vault information into practice numbers.)
2. After you open the vault and tweak the rule, can you test the tweak on the same vault? (No: it has been used; the number would no longer be a test.)
3. Why show practice and vault side by side? (The gap between them is the evidence about overfitting.)

## References
- [Wikipedia: Cross-validation (statistics)](https://en.wikipedia.org/wiki/Cross-validation_(statistics)): holding data out, with the time-series caveat (read earlier, Sprint 04).
- [Wikipedia: Backtesting](https://en.wikipedia.org/wiki/Backtesting): in-sample vs out-of-sample use (read 2026-11-09).
- [Wikipedia: Walk forward optimization](https://en.wikipedia.org/wiki/Walk_forward_optimization): related rolling method (read earlier, Sprint 04).
- MarketLab ADR 0012 (studies, trials, embargo, one-use holdout) and `docs/02-domain/validation.md`.
