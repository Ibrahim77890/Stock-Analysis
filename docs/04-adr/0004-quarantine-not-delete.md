# ADR 0004: Quarantine invalid rows, never delete

Status: accepted (Sprint 01)

## Context
Silent dropping hides provider errors and makes row counts irreconcilable.

## Decision
The loader rejects rows that break the hard rules (same rules as the CHECK constraints) into `market.bar_quarantine` with a reason and the raw record. Soft anomalies (large moves, stale prices, gaps) are loaded and only flagged in `market.data_quality_result`. Every job must satisfy rows_read = inserted + updated + unchanged + rejected.

## Alternatives
Drop bad rows; fail the whole file on the first bad row.

## Consequences
Quarantine needs periodic review; flagged outliers are never auto-corrected.
