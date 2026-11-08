# Golden-case and property-based testing

**Sprint:** 02    **Used by tasks:** 02_02, 02_03, 02_04, 02_05, 02_08

## Why this matters for MarketLab
Sprint 02 is almost entirely about correctness rules that are easy to get subtly wrong (off-by-one on an ex-date, a window that peeks forward). Single examples catch some of it. Two other techniques catch the rest: hand-computed *golden cases* that anyone can check, and *property tests* that try hundreds of random inputs against an invariant.

## Plain-language explanation
- **Golden case:** a tiny input whose answer you computed by hand (and wrote down with the arithmetic). Example: closes 400, 100 with a 4-for-1 on day 2 -> adjusted as of day 2 is 100, 100. If code disagrees with the hand answer, the code is wrong (or the hand answer is; either way you learn).
- **Property (invariant):** a statement true for *all* inputs, such as "no returned date is after the cursor" or "adjusting then un-adjusting returns the original". A property test generates many random inputs and checks the statement.
- **Truncation test:** a special property for causality: `f(data)[t] == f(data[:t])[t]` for every `t`.
- **Negative test:** an input that must be rejected, or a deliberately broken implementation the test must catch. A test that cannot fail proves nothing.
- Seed random tests (or let the library save failing cases) so a failure can be replayed.

## Key terms
- Golden test, property test, invariant, shrinking (the library reduces a failing input to a minimal one), seed, mutation (breaking the code on purpose to check the test fails).

## Common mistakes / pitfalls
- Golden values copied from the program's own output (circular).
- Random tests with unrecorded seeds that cannot be reproduced.
- Properties so weak they always pass ("result is not None").
- Testing only dates far from boundaries; include ex-date, cursor day, first and last bar.
- Slow property tests on the real database; keep example counts bounded (for instance 100).

## What to implement in this domain
- A `tests/golden/` set (where the owner keeps tests) with the arithmetic written in comments or a small table per case.
- Property tests (Hypothesis, or a seeded `random.Random` loop if you prefer no new dependency) for: cursor bound, truncation invariant, adjustment factor monotonicity (a split never changes the sign of a price).
- For each causal rule, one test that feeds a deliberately leaky implementation and expects the test to fail.

## How to check you understood
1. Why is a golden value taken from your own function's output a bad test? (It can only confirm the code against itself.)
2. State an invariant for adjustment factors. (All factors are positive; bars on and after the latest ex-date have factor 1.)
3. How do you test that your causality test works? (Run it on a leaky indicator and see it fail.)

## References
- [Hypothesis documentation](https://hypothesis.readthedocs.io/en/latest/): strategies, shrinking, settings.
- [pytest: How to parametrize tests](https://docs.pytest.org/en/stable/how-to/parametrize.html): table-driven golden cases.
- [Polars: testing utilities](https://docs.pola.rs/api/python/stable/reference/testing.html) (unverified): `assert_frame_equal` for comparing frames.
- John Hughes, "How to Specify It!" (2019 paper, unverified link): practical property patterns.
