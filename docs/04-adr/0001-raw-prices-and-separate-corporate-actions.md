# ADR 0001: Store raw prices and corporate actions separately

Status: accepted (Sprint 01)

## Context
Adjusted prices change every time a split or dividend occurs, so stored adjusted history silently goes stale and cannot be audited. Replay and backtests need the price as it was traded on each date.

## Decision
`market.bar_daily` stores raw prices only. Splits and dividends live in `market.corporate_action`. Adjusted series are computed as-of on demand (blueprint 23.3).

## Alternatives
Store adjusted prices (simpler reads, but unauditable and provider-specific); store both (duplication, drift risk).

## Consequences
Readers must apply actions to compare across a split; `large_move` quality checks look up splits to explain jumps. The Kaggle fallback is adjusted and cannot be loaded as raw without conversion.
