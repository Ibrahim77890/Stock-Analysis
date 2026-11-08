# Returns and indicators (Sprint 02)

Implemented in `services/market-data/src/market_data/indicators.py`. All functions are pure, take a date-sorted frame with `trade_date` and `close`, return a Series of the same length, and leave the warm-up as null (never filled). Feed **adjusted** prices (see the data dictionary, Adjustment modes): raw prices across a split give a fake return such as -74%.

| Function | Formula | First defined at |
|---|---|---|
| `simple_return` | `P_t / P_(t-1) - 1` | day 2 |
| `log_return` | `ln(P_t / P_(t-1))` | day 2 |
| `sma(n)` | mean of the last n closes including today | day n |
| `ema(n)` | `a*P_t + (1-a)*EMA_(t-1)`, `a = 2/(n+1)`, seeded with the first close (`adjust=False`) | day n (earlier values null) |
| `rolling_volatility(n)` | sample std (ddof 1) of the last n simple returns, times `sqrt(252)` when annualised | day n+1 |

**Causality test** (`check_truncation`): for random cut points `t`, the value at `t` from the full series must equal the value at `t` from the series cut at `t`. All five functions pass 100 cut points on real AAPL data; a deliberately leaky `rolling_mean(center=True)` fails (tests/test_indicators.py). In Swagger: `POST /indicators/causality-check` (use `leaky_centered_sma:5` to see a failing case).

Unsorted input and a window below 1 raise `ValueError`. These are facts and conventions, not a claim that any indicator predicts prices.
