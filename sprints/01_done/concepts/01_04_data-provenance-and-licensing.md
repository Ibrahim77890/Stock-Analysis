# Data provenance and licensing

**Sprint:** 01    **Used by tasks:** 01_02, 01_03, 01_04, 01_10

## Why this matters for MarketLab
You will be able to show a recruiter or user *where every number came from*. You also avoid legal trouble: free access is not the same as permission to redistribute.

## Plain-language explanation
**Provenance** = a record of origin: which provider, which endpoint and parameters, when retrieved, what file/hash, which license. A **manifest** is a small file that holds this for one downloaded dataset. **Licensing** decides whether you may store, display, or redistribute the data; read the terms and write down the answer.

Practical rules for this project:
- Never commit third-party price data to a git repository. Commit download scripts and manifests.
- Keep raw files exactly as received (immutable), and derive everything else from them.
- Record the sha256 of each raw file so results are reproducible and tamperproof.

## Key terms
- **Manifest**: provider, endpoint, parameters, retrieval timestamp (UTC), file path, sha256, row count, license note.
- **Immutable raw layer**: files are written once, never edited.
- **Fair access (SEC)**: declare a User-Agent, respect request rate limits.

## Common mistakes / pitfalls
- Forgetting to record the retrieval date (providers revise history).
- Overwriting raw files during re-download.
- Assuming "public" means "redistributable".

## What to implement in this domain
- A manifest format and a writer function used by the downloader (task 01_04).
- A provenance/licensing table in the data dictionary for every source considered (task 01_03).
- `.gitignore` rules that exclude the raw data folder (task 01_01).

## How to check you understood
1. Given only a manifest, can someone repeat the download? (They should be able to.)
2. Modify one byte of a raw file. Does your tooling notice? (sha256 check should fail.)

## References
- Blueprint sections 6.4 and 25 (local).
- [Alpaca: market data docs](https://docs.alpaca.markets/docs/about-market-data-api) (unverified URL; link from blueprint 25.1): plans, feeds, limits.
- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces): verified in blueprint; access rules for SEC data.
- [SEC webmaster FAQ (developers)](https://www.sec.gov/os/webmaster-faq) (unverified: blocks automated checks): fair-access guidance.
