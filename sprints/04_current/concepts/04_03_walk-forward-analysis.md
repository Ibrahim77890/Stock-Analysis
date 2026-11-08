# Walk-forward analysis

**Sprint:** 04    **Used by tasks:** 04_04

## Why this matters for MarketLab
One train/test split is one draw. Walk-forward repeats the "choose on the past, trade the next block" cycle through time, which mimics how a rule would have been maintained in practice and gives several out-of-sample blocks instead of one. It also shows whether the chosen parameters keep changing (an unstable rule).

## Plain-language explanation
Pick a training length, a test length and an embargo. Start at the beginning: select parameters on the first training window, run them on the next test block, then slide everything forward by one test length and repeat. Each test block uses parameters chosen only from data before it. Stitch the test blocks into one **out-of-sample equity curve** by chaining each block's growth factor.

Example on 1,366 bars: train 500, embargo 5, test 100. Fold k trains on bars `1 + 100(k-1)` to `500 + 100(k-1)` (a rolling window) and tests the 100 bars starting at `506 + 100(k-1)`. There are 8 folds (800 test bars); 61 bars at the end are unused. Each test run gets `slow` bars of warm-up from before its start and starts flat in cash, so every fold begins from 100% cash (a simplification stated in the report).

Rolling windows keep the training length constant; **anchored** (expanding) windows keep the start fixed. This sprint implements rolling only and mentions anchored as a deferred option.

## Key terms
- fold: one train/test pair.
- rolling window: training window of fixed length that slides forward.
- stitched OOS curve: test blocks chained into one curve, rebased to 1 at each block start.
- parameter stability: how often the selected pair changes between folds.
- efficiency ratio (informal): OOS return per bar divided by IS return per bar.

## Common mistakes / pitfalls
- Selecting parameters on a window that overlaps the test block.
- Giving the test run only the test bars (no warm-up), so the first `slow` bars cannot trade.
- Re-optimising on the full OOS result afterwards (turns it into training data).
- Chaining equity levels instead of growth factors (the blocks start at different levels).
- Counting folds as independent confirmations although neighbouring training windows overlap heavily.

## What to implement in this domain
- `walk_forward(bars, spec, grid, train, test, embargo)` returning, per fold: train range, test range, selected parameters, IS metric, OOS metric, trades, plus the stitched OOS equity and its metrics.
- Every fold's selection is recorded as trials in the study (phase `train`); every OOS block as phase `test`.
- Tests: no fold's selection depends on bars after its train end; fold ranges never overlap the test block; stitched growth equals the product of block growth factors.

## How to check you understood
1. With train 500, test 100, embargo 5 and 1,366 bars, how many full folds? (8.)
2. Why does a test block need warm-up bars? (The slow average is undefined for its first `slow - 1` bars.)
3. Fold 3 selects 5/20 and fold 4 selects 40/200. What does that suggest? (Parameter instability; the rule is sensitive to the training window.)

## References
- [Wikipedia: Walk forward optimization](https://en.wikipedia.org/wiki/Walk_forward_optimization): definition and variants (rolling and anchored).
- [Wikipedia: Cross-validation (statistics)](https://en.wikipedia.org/wiki/Cross-validation_(statistics)): relation to time-series validation.
- [Polars user guide](https://docs.pola.rs/): date slicing and joins used to build folds.
