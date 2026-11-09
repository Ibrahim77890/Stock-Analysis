# Multi-source data and reconciliation

**Sprint:** 05    **Used by tasks:** 05_01, 05_03, 05_04

## Why this matters for MarketLab
Every number so far comes from one provider's free IEX feed, and only 5.4 years of it. A second source gives a longer history and a way to catch errors in the first: if two independent vendors disagree on a close, one of them (or our pipeline) is wrong. Blueprint 25.6 asks for exactly this cross-check, and "flag, don't delete" (blueprint 26.1) says how to treat disagreement.

## Plain-language explanation
**Reconciliation** means comparing the same fact from two sources and classifying the differences. For daily bars the fact is "the close of AAPL on 2022-03-01". Two sources can legitimately differ: IEX reports prices and volume from the IEX venue only, while a consolidated source reports all US venues, so volumes differ a lot and closes differ slightly. They should not differ by large amounts on prices.

Example: Alpaca (IEX) close 163.20, Tiingo close 163.18 -> relative difference 0.012% (1.2 bps), fine. Alpaca volume 480,000 vs Tiingo volume 71,000,000 -> ratio 0.7%, expected for IEX and never a quality failure. A close difference of 3% is a mismatch to investigate.

Our schema already keys rows by `source` (`market.bar_daily` primary key includes it), so both sources can live side by side; a read names the source it wants. Never silently mix: a series should come from one source.

**Licence.** "Public" is not "redistributable." Tiingo's free plan is described on its pricing page as internal use only; the data stay in git-ignored `data/` and the database, never in the repository.

## Key terms
- source: the provider a row came from (`alpaca`, `tiingo`), part of the row key.
- reconciliation: comparing two sources for the same instrument and date.
- tolerance: the difference accepted as agreement (stated before looking).
- match / only-in-A / only-in-B: date-level categories.
- primary source: the one a given use reads by default (documented per use).

## Common mistakes / pitfalls
- Comparing IEX volume with consolidated volume as if they should match.
- Comparing prices on the wrong dates (UTC vs exchange-local date; Tiingo's `date` is already a trading date).
- Averaging two sources into a "better" series (hides the disagreement).
- Choosing the tolerance after seeing the differences.
- Treating agreement as proof of correctness (both can share an error).

## What to implement in this domain
- A reconciliation function per symbol returning counts (matched, only-in-A, only-in-B) and quantiles of absolute relative differences for open, high, low and close; volume ratio quantiles reported separately and never flagged.
- Flag rows whose close differs by more than a stated tolerance; classify instead of deleting.
- Corporate-action agreement: same ex-date and same ratio or cash amount.
- Where the project owner keeps it: a new module next to `quality.py`; report files under `data/reports/` and a summary in the docs.

## How to check you understood
1. Two sources show closes 100.00 and 100.05. Difference in bps? (5 bps.)
2. Why is a 99% volume difference between IEX and a consolidated feed not an error? (IEX is one venue; the other is all venues.)
3. Why decide the tolerance before running? (Otherwise it is tuned to make the data look agreeable.)

## References
- [Wikipedia: Data reconciliation](https://en.wikipedia.org/wiki/Data_reconciliation): general idea (note: a different, statistical sense of the term is also described there).
- [Tiingo pricing and licence summary](https://www.tiingo.com/about/pricing): free-tier limits and the "internal use only" wording (read 2026-11-08).
- [Alpaca market data docs](https://docs.alpaca.markets/docs/about-market-data-api): feeds and what IEX data are (already used in Sprint 01).
- [SEC: Securities Information Processor](https://www.sec.gov) (unverified deep link): background on consolidated vs single-venue data.
