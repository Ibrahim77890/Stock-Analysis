# ADR 0005: Adjust prices as of the cursor; do not use provider-adjusted prices

Status: accepted (Sprint 02)

## Context
A provider's adjusted close is rescaled with actions that happen after each bar, so using it in replay or a backtest leaks the future (blueprint 23.3 item 1, 26.2). Sprint 01 stores raw prices and corporate actions separately (ADR 0001).

## Decision
Adjusted series are computed on demand by `market_data.adjust` as of a date: the factor of a bar is the product over actions with bar_date < ex_date <= as_of. Modes: raw, split, split_dividend. `get_bars` uses the effective end date (min(end, max_date)) as as_of. Volume is multiplied by the inverse split factor. Nothing adjusted is stored.

## Alternatives
Store adjusted columns (stale after every new action, and leaks); use Alpaca's adjustment=all (leaks, provider-specific); backward-adjust to the latest price (leaks).

## Consequences
Every read recomputes factors (a few dozen action rows per symbol, negligible); callers must pass the cursor. Evidence: golden tests, a 100-case causality property test, a 20-case truncated-database test, and negative tests with leaky variants (tests/test_adjust.py, tests/test_replay_and_reads.py). Spin-offs, mergers and symbol changes are not handled.
