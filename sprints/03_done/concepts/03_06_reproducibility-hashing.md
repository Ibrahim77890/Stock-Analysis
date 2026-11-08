# Reproducibility: canonical configuration, dataset fingerprint and result hash

**Sprint:** 03    **Used by tasks:** 03_01, 03_05

## Why this matters for MarketLab
Blueprint 23.2 requires: same strategy spec + parameters + dataset manifest + engine version must give an identical result, and the hash proves it. Without it, "I got 12% last week" cannot be checked, and a silent data reload or code change can move results unnoticed.

## Plain-language explanation
A **hash function** (SHA-256) turns bytes into a fixed 64-character fingerprint; one changed byte gives a totally different fingerprint. To hash a configuration you first need **canonical bytes**: JSON with sorted keys, no extra whitespace, fixed number formatting. Otherwise `{"a":1,"b":2}` and `{"b":2,"a":1}` hash differently although they mean the same.

Three layers:
1. `config_hash` = sha256(canonical JSON of: strategy spec, costs, dates, fill model, engine version, dataset fingerprint).
2. `dataset_fingerprint` = sha256 of the exact bars the run used (canonical CSV text of date, open, high, low, close, volume at fixed precision), together with the raw-file manifest sha256 when known.
3. `result_hash` = sha256 of canonical bytes of the equity curve and trade list, with numbers rounded to a stated precision.

Rerun check: recompute from the stored config; the new `result_hash` must equal the stored one. If it does not, either the data changed (fingerprint differs: explain which) or the engine is non-deterministic (a bug).

Example: change `slippage_bps` from 5 to 5.0. Canonical JSON must treat them the same, or you need a rule (store as a decimal string). Decide and test it.

## Key terms
- canonical form: one agreed byte representation of equivalent data.
- fingerprint: hash identifying a dataset's exact content.
- determinism: same inputs always give the same outputs (seeded randomness only).
- engine version: a string bumped on any change that can alter results.

## Common mistakes / pitfalls
- Hashing Python dict repr (order and format not guaranteed across versions).
- Hashing floats at full precision across machines (tiny differences); round to a documented precision first.
- Forgetting the engine version or the cost settings in the hash.
- Unseeded randomness inside a run.
- Treating an equal hash as correctness: it proves repeatability, not that the logic is right.

## What to implement in this domain
- `canonical_json()`, `dataset_fingerprint()`, `config_hash()`, `result_hash()` in one small module.
- Stored with each run (table `research` schema, owned by the Python service); a unique constraint on `config_hash` prevents duplicate rows.
- `ENGINE_VERSION` constant with a rule written in the ADR: bump when results can change.
- Tests: key order does not matter; changing any one field changes the hash; rerun gives the same `result_hash`; a modified bar changes the fingerprint.

## How to check you understood
1. Why sort keys? (So equivalent configs give the same bytes.)
2. A reload changes one volume value. Which hash changes first and why? (The dataset fingerprint, so the config hash and likely the result hash.)
3. Does a matching hash show the strategy is profitable? (No, only that it is repeatable.)

## References
- [Python hashlib](https://docs.python.org/3/library/hashlib.html): SHA-256 (verified reachable).
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785): the formal version of "canonical JSON" (verified reachable; the project uses a simpler documented rule).
- [Reproducible Builds: deterministic build systems](https://reproducible-builds.org/docs/deterministic-build-systems/): same idea applied to software (verified reachable).
