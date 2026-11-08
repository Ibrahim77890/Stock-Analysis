# Data feeds, volume semantics and lineage

**Sprint:** 02    **Used by tasks:** 02_01, 02_07

## Why this matters for MarketLab
Sprint 01 found that the free feed starts in 2018 and reports IEX-only volume. A learner who sees "volume 453,459" for AAPL must be told that it is a fraction of the consolidated day, and should be able to ask "where did this chart's data come from?". A lineage view builds trust and is the "data lineage panel" of blueprint 23.2.

## Plain-language explanation
US equities trade on many venues. The **consolidated tape (SIP)** combines all of them; **IEX** is one exchange, so its volume is a small share of the total (AAPL: 453,459 IEX shares on 2020-08-25 vs tens of millions consolidated; the real figure must come from your own data, not from memory). Prices on IEX bars are IEX trades only, so highs/lows can differ from consolidated ones too.

**Lineage** answers: which provider, endpoint and parameters produced these rows, when (`retrieved_at`), which file (sha256), which loader job, which adjustment, and which quality flags apply. The Sprint 01 manifests and `ingestion_job` rows already hold most of it; the work is to join and expose them.

A **universe caveat** states honestly that the 53 symbols are today's survivors, so results on them are survivorship-biased.

## Key terms
- Feed (IEX vs SIP), consolidated volume, venue
- Manifest, ingestion job, content hash
- Lineage, provenance, reproducibility hash
- Survivorship caveat

## Common mistakes / pitfalls
- Comparing volume across feeds or against numbers from another site.
- Hiding the feed in a footnote; show it next to any volume figure.
- Lineage that cannot be reproduced (no hash, no parameters).
- Claiming the effective window is 2016 when the first bar is in 2018.
- Reading a licence summary from memory instead of the provider's actual terms page.

## What to implement in this domain
- A read function that joins `bar_daily` rows' `ingestion_job_id` to `ingestion_job` and the manifest file to return: provider, feed, adjustment, retrieved_at, file hash, loader job id, row counts, first/last bar date, quality-flag counts by rule.
- Static text fields: `feed_caveat` and `universe_caveat`.
- In 02_01: read the actual terms of each source and paste the exact sentences into the data dictionary Sources table (or keep "terms unclear" with a reason).

## How to check you understood
1. Why is IEX volume not comparable with consolidated volume? (It counts only trades on one venue.)
2. Which existing tables let you trace a bar back to a file? (`bar_daily.ingestion_job_id` -> `ingestion_job.file_name, file_sha256` -> manifest.)
3. Name two caveats the lineage response must contain. (Feed volume scope; survivorship-biased universe.)

## References
- [Alpaca docs: Market data FAQ and feeds](https://docs.alpaca.markets/docs/market-data-faq) (unverified): the difference between `iex` and `sip` and plan limits.
- [IEX Exchange](https://www.iexexchange.io/): what IEX is and its market-share statistics (verify the current figures yourself).
- [SEC: Market data infrastructure / SIP overview](https://www.sec.gov/marketstructure) (unverified): consolidated tape background.
- [W3C PROV overview](https://www.w3.org/TR/prov-overview/): vocabulary for provenance, optional background.
- `docs/02-domain/data-profile-v1.md`: the measured window, gaps and quarantined bar from Sprint 01.
