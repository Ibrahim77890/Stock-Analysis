# The replay cursor and leakage testing

**Sprint:** 02    **Used by tasks:** 02_04, 02_06

## Why this matters for MarketLab
Replay shows a learner history "as if live". If any code path returns a bar dated after the learner's position, the whole product teaches the wrong lesson, and the bug is silent because the charts still look fine. The blueprint lists a leaked future as one of the five ways the project can be invalidated (26.2) and requires the cursor to be enforced in **one** data-access layer.

## Plain-language explanation
A **cursor** is a date `D` held on the server for a replay session. Every read must return only `trade_date <= D`. "Server-bounded" means the browser never gets a chance to ask for more: even `start=2025-01-01&end=2025-12-31` with cursor `2020-06-30` returns only bars up to 2020-06-30.

To trust this you test it, not just write it:
1. **Single choke point:** all code that reads market tables goes through one module; a test fails if any other module contains SQL against `market.bar_daily`.
2. **Fuzz test:** pick 200 random cursors and random ranges; assert `max(trade_date) <= cursor` for each response.
3. **Truncation (causality) invariant:** the response at cursor `D` must equal the response computed from a database copy that contains no data after `D`. If they differ, something peeked at the future (for example an adjustment using a later split).
4. **Blind view:** hide identity by rebasing prices to 100 and labelling dates "day 1..n". This is presentation, not security, so the cursor still applies.

## Key terms
- Cursor: latest visible date for a session.
- Replay boundary invariant: no response contains a bar after the cursor.
- Choke point: the only module allowed to read the bar tables.
- Fuzz / property test: run a check over many random inputs.
- Truncation test: compare a result with the result from data cut at the cursor.
- Rebased series: prices scaled so the first visible bar equals 100.

## Common mistakes / pitfalls
- Enforcing the cursor in the UI or in one endpoint only.
- Letting an indicator or adjustment look at rows after the cursor even if the final output is trimmed.
- An off-by-one: `<` instead of `<=`, or a time-zone shift turning one date into the next.
- Using a global "now" instead of the session's cursor.
- Testing only the happy path; always include a request that tries to exceed the cursor (negative test).

## What to implement in this domain
- A `replay` module (where the project owner keeps domain code) with a cursor object; every read takes the cursor and applies it in SQL.
- A structural test that no other module queries the bar tables.
- A fuzz test with random cursors and ranges, run against the real loaded data and against the HTTP layer later.
- A truncation test using a temporary copy of the data cut at the cursor.
- A `blind_view` function (rebase to 100, day indices) with tests that the output contains no symbol, real dates or absolute price level.

## How to check you understood
1. Cursor 2020-06-30, request end 2021-01-01. What dates may come back? (None after 2020-06-30.)
2. Why is trimming the response in the API handler not enough? (Other code paths, adjustments or indicators may already have used later rows.)
3. What does a failing truncation test tell you? (A result depends on data after the cursor.)

## References
- [Hypothesis documentation](https://hypothesis.readthedocs.io/en/latest/): property-based testing, the fuzz idea in code.
- [pytest documentation](https://docs.pytest.org/en/stable/): parametrisation and fixtures used for the cursor tests.
- [PostgreSQL: SELECT ... WHERE and date types](https://www.postgresql.org/docs/current/datatype-datetime.html): `DATE` comparison semantics.
- Marcos Lopez de Prado, *Advances in Financial Machine Learning* (book): look-ahead bias and purging in research pipelines.
- MarketLab blueprint sections 23.2 (blind replay) and 26.3 (replay boundary invariant).
