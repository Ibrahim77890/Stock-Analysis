# Append-only records and reconciling a ledger

**Used by tasks:** 09_03, 09_04, 09_08

## What it is
An append-only table is only ever inserted into. A ledger that is derived from it (positions, results) can be rebuilt at any time, and its totals must equal the sum of the rows. This is the standing invariant "reconciliation" of the project.

## Why it matters here
The journal and its results must be reproducible: deleting the derived numbers and recomputing from the decisions gives the same answer, and counts shown on screen equal counts in the table.

## Key ideas
- Constraints can forbid updates in the schema (a trigger or revoked privileges) instead of relying on convention.
- Idempotent submission: the same decision sent twice (a double click) stores one row, using a client-supplied key.
- Reconciliation test: a script recomputes every result and compares.

## Common mistakes
Relying on "we never update" as the only protection; losing double-click protection; storing derived values that can drift.

## Check yourself
1. How do you make a double click safe? 2. How do you prove the displayed results match the table?

## References
- Append-only: https://en.wikipedia.org/wiki/Append-only (verified reachable 2026-11-10)
