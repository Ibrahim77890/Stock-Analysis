# ADR 0009: Backtest execution model (next-open fills, split-adjusted prices, flat bps costs)

Status: accepted (Sprint 03)

## Context
Backtest numbers depend on timing and cost conventions. The commonest silent error is deciding on a bar's close and trading at the same close (blueprint 23.3, 26.2). The model must be simple, explicit and testable by hand.

## Decision
- One asset, long-only, no leverage, fractional shares, initial cash 100,000 (configurable), all-in / all-out.
- Strategy v1: SMA(fast) > SMA(slow) at the close of day t gives target 1, else 0 (warm-up gives 0).
- `next_open` (default, realisable): the order from day t's signal fills at the **open of day t+1**. `same_close` fills at the signal bar's close; it is a labelled teaching mode and results carry `realisable = false`.
- A signal on the last bar has no next bar and is not filled.
- Costs on every fill, in basis points: buy price = reference * (1 + slippage), sell price = reference * (1 - slippage), commission = commission_bps * fill value. All-in buy: shares = cash / (price * (1 + commission)).
- Equity is marked at each close: cash + shares * close.
- A position still open on the last bar is recorded as an **open trade** (`closed = false`) valued at the last close with no exit cost.
- Accounting identity (tested): `final equity = initial cash + sum(trade pnl)`, where pnl = proceeds - commission - cash spent (so it is net of commission and slippage).
- Prices: bars are **split-adjusted as of the run's end date** (`get_bars(adjustment="split")`). Relative to the series adjusted as of day t this is a constant rescale of all earlier prices; with fractional shares and a scale-invariant rule (SMA comparison) equity does not change. This is tested by the engine truncation test across the 2020-08-31 AAPL split. Dividends are not included in returns (understates total return); stops and targets are not modelled (daily bars hide the intrabar path).
- Risk-free rate is 0 in Sharpe; 252 trading days per year (docs/02-domain/backtest.md).
- `ENGINE_VERSION` (currently "1") is part of the config hash; bump it whenever a change can alter any result.

## Alternatives
Fill at the next close or at a VWAP (needs intraday data); integer lot sizes (rounding noise, deferred); per-date as-of adjustment inside the loop (heavier; unnecessary for scale-invariant rules, would be needed for rules using absolute price levels); dividend-adjusted prices (leak the future; see ADR 0005).

## Consequences
Every number can be reproduced by hand on a small table (golden cases in `tests/test_backtest.py`). Rules that use absolute price levels must not use this price basis. Real-data check: on AAPL and SPY the leaky `same_close` fill did not beat `next_open` (backtest-worked-example.md), so the detector is a warning about method, not a guaranteed inflation.
