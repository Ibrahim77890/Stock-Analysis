# ADR 0006: The replay cursor is enforced in one data-access layer

Status: accepted (Sprint 02)

## Context
A forgotten query path that returns bars after the viewer's position silently invalidates replay and backtests (blueprint 26.2 item 1).

## Decision
Only `read.py` (plus `load.py`, which writes, and `quality.py`, which has its own checks) may contain SQL against market.bar_daily; a structural test fails if any other module does. Replay reads go through `replay.visible_bars`, which passes the session cursor as max_date. A session cursor moves forward only (advance >= 1) and stops at the last stored session. `blind_view` hides symbol and dates and rebases to 100; it is presentation, not security.

## Alternatives
Enforce the cursor in each API handler (easy to forget); a database view or row-level security (heavier than needed).

## Consequences
New features must read bars through get_bars/replay. Evidence: 200-cursor fuzz tests on the database and over HTTP, truncation test, and a test that proves the structural check detects a new offending module.
