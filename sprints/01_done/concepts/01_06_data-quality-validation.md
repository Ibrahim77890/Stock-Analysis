# Data-quality validation

**Sprint:** 01    **Used by tasks:** 01_05, 01_07, 01_08

## Why this matters for MarketLab
A backtest on bad data gives confident, wrong answers. The product promise is to teach people to distrust results; the first thing to distrust is the data. Quality checks and reports are also a visible engineering deliverable (Data Explorer, blueprint 5.5).

## Plain-language explanation
Checks come in three kinds:
- **Hard rules** (row is invalid): `high >= max(open, close)`, `low <= min(open, close)`, `low <= high`, prices > 0, `volume >= 0`, no duplicate key.
- **Soft rules** (flag, investigate): daily move above a threshold (e.g. |return| > 40%), zero volume on a trading day, price unchanged for many days.
- **Completeness rules**: compare expected sessions (calendar) with present dates and *classify* each gap.

Policy: hard-rule violations go to quarantine with a reason; soft flags are stored but the row is kept; outliers are **flagged, never deleted**. Produce a **report** (counts per rule, per symbol, examples) every run.

Example: a row with high=10, close=10.5 is quarantined with reason `high_lt_close`. A +300% day is kept but flagged `large_move`, and the report links it to a split in the corporate-action table if one exists.

## Key terms
- **Constraint** (database enforced) vs **validation** (pipeline enforced), **quarantine**, **flag**, **gap classification**, **reconciliation** (counts in = counts out + rejected).

## Common mistakes / pitfalls
- Deleting outliers (they may be real: crashes, splits).
- Checking only in the database or only in code. Do both for hard rules.
- Reporting only totals; keep per-symbol and example rows.

## What to implement in this domain
- Rules as small pure functions with unit tests (task 01_08).
- Report as a Postgres table and a markdown/JSON file (task 01_08).
- Database `CHECK` constraints for the hard rules (task 01_06).

## How to check you understood
1. Why is a zero-volume day not necessarily an error? (Thinly traded symbols, halts; flag it.)
2. Write the reconciliation formula for a load. (`rows_read = inserted + updated + unchanged + rejected`.)

## References
- Blueprint section 8.6 (local).
- [PostgreSQL: Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html): `CHECK`.
- [Great Expectations](https://greatexpectations.io/): well-known data-validation framework; study its vocabulary (expectations, validation results). Not required to use it this sprint.
- [Polars docs](https://docs.pola.rs/): expressions for vectorised checks.
