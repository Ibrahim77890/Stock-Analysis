# ADR 0003: Data source and license position

Status: accepted; terms read 2026-11-08 (Alpaca redistribution terms remain unclear)

## Context
Public availability is not permission to redistribute. Raw data must be reproducible but not committed.

## Decision
Primary source: Alpaca free plan (`adjustment=raw`, IEX feed). Fallback: Kaggle Huge Stock Market Dataset. All downloaded data lives in git-ignored `data/` with a manifest per file (provider, parameters, retrieved_at, sha256, license note). Redistribution is treated as not allowed.

## Alternatives
yfinance (unofficial, restrictive terms); Stooq bulk (adjusted, terms unclear).

## Consequences
The exact license sentences in the data dictionary Sources table still have to be read and pasted by the project owner. IEX-only volume is a known limitation.

## Update 2026-11-08 (task 02_01)
Provider pages were read (see the data dictionary Sources table for the quoted sentences). Result: SEC EDGAR content is free to reuse; yfinance/Yahoo is personal-use only; Alpaca's governing market-data agreements (linked PDFs) were not read, so redistribution stays **no**; Kaggle and Stooq terms could not be established. Position unchanged: no third-party price data is committed or redistributed. The documented Basic-plan history ("Since 2016") does not match the data returned (first bar 2018-04-25); the effective window is 2018-04-25 to 2025-12-31.
