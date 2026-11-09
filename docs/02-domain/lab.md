# The Strategy Lab (Sprint 07)

The Lab lets a learner try **one simple rule** on the old prices of a stock, always beside buy and hold, and then spend a single look at a **locked vault** of newer years. It is built to show, not to tell, how easily a good-looking result appears by luck. Decision record: ADR 0017. Screens: `apps/web/src/lab`. Gateway: `apps/api/src/lab`. Engine and honesty tools: `services/market-data/src/market_data/lab/study.py` (built on the Sprint 03 backtest and the Sprint 04 validation tools). Architecture: `system-overview.md`.

## What a learner does
1. **Lab home.** Short "what this is and is not", how a study works, a stock picker (stocks with at least 12 years of daily prices; today 52 symbols), and the learner's own studies.
2. **Start a study.** The practice window and the vault are fixed now. The page says only how many years each holds.
3. **Write a rule and run it.** A short and a long moving average (days) and a cost per trade (basis points). The rule buys when the short average is above the long one and sells when it is not (the Sprint 03 `sma_crossover`, filled at the next open). Each new rule counts as one **idea tried**; the same rule again is recomputed and not counted twice.
4. **Read the cards** (fixed order, below).
5. **Open the vault once.** Pick one of the rules already tried, type `OPEN`, confirm. The page then shows practice and vault side by side and one fixed sentence about the gap.

## The result cards, and where each number comes from
| Card | Source field (gateway `LabRunDto`) | Meaning in plain words |
|---|---|---|
| Headline | `rule.total_return`, `buy_hold.total_return`, `practice_years` | "100 in your rule became X; 100 in buy and hold became Y." |
| Growth of 100 | `growth.dates`, `growth.rule`, `growth.buy_hold` (at most 300 points, first and last kept) | Both lines start at 100 on a log axis; the rule is solid, buy and hold is dashed. A table of yearly changes (`yearly`) is the text alternative. |
| The numbers | `rule` and `buy_hold`: `total_return`, `cagr`, `max_drawdown`, `exposure`, `trades` (Sharpe under "Show more") | Total change, per year, worst fall, time in the stock, trades; each rule number has its buy-and-hold number beside it. Under 20 trades a notice says "too few to learn much". |
| Costs | `costs[]` at 0, 2, 5, 10 and 20 bps | The same rule at five cost levels. One sentence says where the rule falls behind buy and hold and where it stops making money (worked out in the page from this table only). |
| Luck | `luck.fraction_as_good`, `n_paths`, `p5`, `median`, `p95` | "Mixing up the order of the days 100 times, N of 100 mixed-up histories did as well or better." This tests timing luck only. |
| Ideas tried | `trial_count`, `overfitting_meter` (from the second idea on) | The list of rules tried and a warning light: the more rules tried, the better the best one looks by luck alone. |
| What this does not tell you | fixed text (`src/copy/lab.ts`) | One stock and one period; practice years only; costs and tax simplified; the future may differ; trying many rules inflates the best result; not advice. |

Words that mislead are not used ("beats the market", "edge", "profit", "alpha", "guarantee", "winning", "proof"); a test scans the copy and every rendered result for them.

## The vault comparison
After the vault opens the page shows, for the chosen rule and for buy and hold, practice and vault side by side (total change, per year, worst fall, trades, Sharpe) and the number of ideas tried. One sentence follows from the **Sharpe ratio** on each window (it does not depend on how long the window is): vault Sharpe below practice Sharpe by more than 0.3 gives "much worse ... common after trying many ideas"; within 0.3 gives "about as well ... one study is still one sample"; above by more than 0.3 gives "better ... one lucky vault is still one sample"; a missing value gives "too little activity to compare". The page never judges the rule.

## What is hidden, and how
Before the vault opens no reply holds a vault date, a vault number or the practice end as a field. The practice years do appear (the chart's last date is the last practice session). Python takes bars with `end = practice_end` only, so practice results cannot depend on vault data; the gateway rebuilds every reply from field lists; the page shows years as counts. Tests: a leak fuzz on the real stack (3 stocks x 2 learners x 20 random rules, 120 runs, every reply, error body and header), a data-change test (delete the vault rows, 10 rules give byte-identical results) and a planted-leak check that the scan itself catches.

## Limits
Rule 2 <= fast < slow <= 300; cost 0 to 50 bps; 10 to 200 mixed-up histories (default 100); at most 200 trials per study; one vault use; 20 studies per learner; 20 runs and 3 vault tries per minute per learner (429 with `Retry-After`); at most 6,000 bars per run; run time is bounded by a 30-second timeout (504 with a plain message). Measured times: `docs/03-benchmarks/benchmark-03-lab-run-latency.md`.

## Worked example (real Tiingo data, AAPL, 17 practice years and a 4-year vault)
Three rules on the practice years (20/100, 10/50, 5/25 days, 2 basis points, seed 1, 100 mixed-up histories), then the vault with 20/100. The numbers below are produced by `services/market-data/scripts/reports/lab_worked_example.py`, and `--check` compares this block with a fresh run.

<!-- worked-example:start -->
```json
{
  "practice_years": 17.0,
  "ideas_tried_before_vault": 3,
  "practice_rule_20_100": {
    "total_return": 51.7835,
    "cagr": 0.2632,
    "max_drawdown": -0.4572,
    "exposure": 0.7244,
    "trades": 25.0,
    "sharpe": 1.0567
  },
  "practice_buy_hold": {
    "total_return": 182.6069,
    "cagr": 0.3595,
    "max_drawdown": -0.6087,
    "exposure": 0.9998,
    "trades": 1.0,
    "sharpe": 1.0976
  },
  "cost_table_rule_total_return": {
    "0": 52.3033,
    "2": 51.7835,
    "5": 51.0133,
    "10": 49.7545,
    "20": 47.3275
  },
  "luck_fraction_as_good": 0.39,
  "vault_years": 4.0,
  "vault_rule": {
    "total_return": 0.1265,
    "cagr": 0.0305,
    "max_drawdown": -0.3274,
    "exposure": 0.6094,
    "trades": 8.0,
    "sharpe": 0.2539
  },
  "vault_buy_hold": {
    "total_return": 0.6051,
    "cagr": 0.1268,
    "max_drawdown": -0.3336,
    "exposure": 0.999,
    "trades": 1.0,
    "sharpe": 0.5603
  }
}
```
<!-- worked-example:end -->

Reading it: on the 17 practice years the rule turned 100 into about 5,278 while buy and hold turned 100 into about 18,361, so it already trailed the benchmark, and costs of 0 to 20 basis points changed the result only a little. On the 4 vault years its Sharpe ratio fell from 1.06 to 0.25 and it returned +13% against +61% for buy and hold, which the page reads as "much worse on years it had not seen". About 39 of 100 mixed-up histories did as well as the rule on practice, so its practice result was not unusual. It is one stock and one study; the example shows the pattern the Lab teaches, not a result about AAPL or about moving averages.

## What the Lab cannot do
It does not find rules that work. A good practice result followed by a worse vault result is the normal outcome the Lab teaches. It tests one rule family, on one stock, on prices that include dividends and splits as of the practice end, with costs as a flat slippage. It is for the owner's machine: the Tiingo data licence is internal use only.
