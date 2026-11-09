# Scoring probability guesses (Sprint 06)

Code: `services/market-data/src/market_data/learning/scoring.py` (pure functions: no database, no I/O). Tests: `tests/learning/test_scoring.py`. Decision: ADR 0015. Every number shown to a learner comes from here; the web app computes nothing.

## Definitions
A guess is `p` = the probability that the close `h` bars ahead is **strictly higher** than the close now, with `p` in [0.01, 0.99]. The outcome `y` is 1 if it was higher and 0 otherwise (**ties count as 0**). `h` is 1, 5 or 10.

| Quantity | Formula | Notes |
|---|---|---|
| Brier score | mean of `(p - y)^2` | 0 is perfect, 1 is worst; always saying 0.5 gives exactly **0.25** |
| Skill score | `1 - BS / 0.25` | against the coin flip; positive means better than 0.5 every time |
| Log loss | `-mean(y ln p + (1-y) ln(1-p))` | `p` is limited to [0.01, 0.99] so it stays finite |
| Calibration bins | ten bins `[0, 0.1) ... [0.9, 1.0]` | per bin: `n`, mean forecast, observed share, Wilson 95% interval; a bin with `n < 5` is flagged `sparse` |
| Wilson interval | `centre = (p + z²/2n)/(1 + z²/n)`, `half = z sqrt(p(1-p)/n + z²/4n²)/(1 + z²/n)`, z = 1.96 | stays inside [0, 1]; 5 of 10 gives about 0.24 to 0.76 |
| Murphy decomposition | `BS = REL - RES + UNC` | `UNC = ybar (1 - ybar)`; exact only when forecasts are constant inside bins (`exact` says which) |
| Baselines | coin flip 0.25; constant `ybar` with Brier `ybar (1 - ybar)` | the second is **in-sample** and therefore flatters |
| Luck check | seeded permutation of the outcomes within each horizon, 5,000 shuffles | `luck_probability = (1 + count) / (5000 + 1)`, never 0; `count` = shuffles scoring at least as well |

Worked example: guesses 0.9, 0.8, 0.3, 0.6 and outcomes 1, 0, 0, 1 give squared errors 0.01, 0.64, 0.09, 0.16, so the Brier score is **0.225**, the skill score 0.10, and the log loss is `-(ln 0.9 + ln 0.2 + ln 0.7 + ln 0.6)/4`.

## Rules for honesty
- **Fewer than 30 answered guesses:** `enough = false`, the warning "too few resolved predictions to say anything" is returned, and the luck result is flagged `not_reported`. The screens show no better-or-worse wording.
- **Overlapping horizons:** a warning is returned whenever a horizon above 1 is present: a 10-bar guess made every day shares most of its days with its neighbours, so the effective sample is smaller than `n`.
- **Permutation assumptions:** outcomes are treated as exchangeable under "no skill"; autocorrelation weakens this, which is why the screens call the result a rough guide.
- **On made-up (random-walk) episodes** no honest forecaster beats 0.25 on average; a confident guesser scores worse.

## Not covered
Probability calibration repair, comparing learners with each other, effective-sample-size estimates, log-loss based luck checks.
