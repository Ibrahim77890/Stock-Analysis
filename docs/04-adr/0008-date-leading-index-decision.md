# ADR 0008: Do not add a (trade_date, instrument_id) index to market.bar_daily yet

Status: accepted (Sprint 02, task 02_01)

## Context
The Sprint 01 benchmark showed the all-symbols-on-one-date query was the slow case at 12.6M rows. An index leading with trade_date was tested on the bench schema (see the benchmark report, section Index experiment).

## Decision
Do not add migration 0007 now. Measured on this machine (warm, same seed): W3 p50 523.6 ms to 86.0 ms and p95 2,198 ms to 184 ms with the index; the index costs 511 MB built after load (about 912 MB built before load), and load throughput fell from 72,144 to 60,410 rows/s when it is present during load. The real table holds 72,314 rows, where the query is cheap. Create the index after a bulk load when a cross-sectional feature or a much larger universe exists.

## Alternatives
Add the index now (cost without a current need); partitioning or BRIN (not justified by any measurement).

## Consequences
No cross-sectional screen should be promised at large scale until the index exists. Cold-cache behaviour is unmeasured (service restart needs administrator rights). Run-to-run noise on this machine exceeded 2x between earlier runs, so the decision rests on a 6x to 12x effect on W3 only.
