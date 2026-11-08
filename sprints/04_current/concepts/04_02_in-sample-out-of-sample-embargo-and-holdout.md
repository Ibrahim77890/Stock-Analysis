# In-sample, out-of-sample, embargo and the frozen holdout

**Sprint:** 04    **Used by tasks:** 04_01, 04_03

## Why this matters for MarketLab
If parameters are chosen on the same bars that are then used to score the strategy, the score is optimistic by construction. A time split makes the score honest only if the test data stay untouched and no information leaks across the boundary. This is the validation layer of blueprint 26.4 item 7.

## Plain-language explanation
Split the bars by **time** (never shuffled, because time order matters): the earlier part is **in-sample** (training, used to choose parameters), the later part is **out-of-sample** (test, used once to score the chosen parameters). Typical result: the chosen rule looks great in-sample and weaker out-of-sample; that gap is the **decay**, an estimate of how much of the in-sample number was fit.

An **embargo** is a gap of a few bars between the end of training and the start of testing. It matters because an indicator (an SMA of 50 bars) or an open position at the end of training carries information into the first test bars. A **holdout** is a final slice kept back for one last look at the very end of the work. If you look at it twice and change something in between, it becomes training data.

Example with 1,366 bars: train = bars 1 to 1,000, embargo = 5 bars, test = bars 1,006 to 1,366 (361 bars). Parameters are selected using only bars 1 to 1,000; the test run uses the chosen parameters and gets `slow` bars of warm-up from before the boundary (the average needs history, which is allowed because it is past data).

## Key terms
- in-sample / out-of-sample: training part / untouched test part of a time-ordered series.
- decay: in-sample metric minus out-of-sample metric.
- embargo: bars skipped after the training end before testing starts.
- warm-up: past bars supplied only so indicators exist at the first test bar.
- holdout: data used once, at the end, to judge the final choice.
- leakage: any way the test data influence the choice of parameters.

## Common mistakes / pitfalls
- Choosing parameters, looking at the test score, and choosing again (the test is now training data).
- Letting the selection function see test bars (for example by normalising with the full-sample mean).
- Random k-fold splitting of time series (puts future bars in training).
- Splitting so that the test block is too short to contain more than a handful of trades.
- Forgetting that this sprint's data window is short (mostly 1,366 bars): splits leave few trades, so the out-of-sample estimate is noisy.

## What to implement in this domain
- `split_by_date` / `evaluate_split`: select on train only, then run the chosen pair on test with warm-up and embargo.
- A leakage test: change the test bars arbitrarily and show the selected parameters do not change.
- A holdout guard: a study can run the holdout evaluation once; a second call is refused and the first use is recorded.
- Report: IS metric, OOS metric, decay, number of OOS trades, number of trials.

## How to check you understood
1. You train on bars 1 to 1,000 and select 10/40. A teammate changes bar 1,200. Should the selection change? (No; if it does, there is leakage.)
2. Why a time split and not a random split? (A random split mixes future bars into training.)
3. What does a large positive decay suggest? (A large part of the in-sample result was fit to noise.)

## References
- [Wikipedia: Cross-validation (statistics)](https://en.wikipedia.org/wiki/Cross-validation_(statistics)): general idea of holding out data; note the time-series caveat.
- [Wikipedia: Backtesting](https://en.wikipedia.org/wiki/Backtesting): context, including in-sample vs out-of-sample use.
- [Wikipedia: Data dredging](https://en.wikipedia.org/wiki/Data_dredging): why a reused test set stops being a test set.
- [Polars user guide](https://docs.pola.rs/): slicing frames by date.
