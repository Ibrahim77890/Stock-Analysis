# ADR 0010: Schema `research`, run storage and the reproducibility hash

Status: accepted (Sprint 03)

## Context
Blueprint 23.2 requires that the same configuration, dataset and engine version give an identical result, provably. Blueprint 24 assigns a `research` schema to the Python service.

## Decision
- Migration `0007` creates schema `research` with `backtest_run` (unique `config_hash`, `result_hash`, `engine_version`, `spec` JSONB, `dataset_fingerprint`, metrics JSONB), `backtest_trade` and `backtest_equity` (both `ON DELETE CASCADE` from the run). Only the Python service migrates and writes it; it reads `market` only through `read.get_bars`.
- `config_hash = sha256(canonical JSON {spec, dataset fingerprint, engine version})`. Canonical JSON: sorted keys, no whitespace, spec numbers as plain decimal strings (`5`, `5.0` and `5.00` are the same), dates ISO.
- `dataset_fingerprint = sha256` of the exact bars used as CSV text (date, OHLC at 6 decimals, integer volume).
- `result_hash = sha256` of canonical JSON of the rounded equity curve (6 decimals) and trade list.
- `save_run` is idempotent on `config_hash`. `reproduce_run` returns `reproduced`, `data_changed` (fingerprint differs) or `engine_mismatch` (same data, different result).
- Shuffle-test and cost-sweep outputs are returned, not stored, in Sprint 03.

## Alternatives
Hash raw files only (misses adjustments and the cut window); store equity as Parquet (extra moving part); RFC 8785 canonical JSON (the documented simple rule is enough for our types).

## Consequences
A data reload that changes any used bar changes the fingerprint and is reported as such. A matching hash proves repeatability, not correctness. Floating-point results are rounded before hashing; a different CPU or library version could in theory differ in the last bit beyond that rounding, which would show as `engine_mismatch`.
