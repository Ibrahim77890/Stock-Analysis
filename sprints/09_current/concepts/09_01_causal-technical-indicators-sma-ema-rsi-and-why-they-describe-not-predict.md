# Causal technical indicators: SMA, EMA, RSI, and why they describe and do not predict

**Used by tasks:** 09_01, 09_02, 09_05

## What it is
An indicator is a number computed from past prices only. A **simple moving average (SMA)** is the mean of the last N closes. An **exponential moving average (EMA)** weights recent closes more. The **relative strength index (RSI)** compares average gains with average losses over N days (usually 14) and maps the ratio to 0 to 100. Each value on day t may use only data up to day t: that is what *causal* means, and it is the same rule that keeps the blind guess game honest.

## Why it matters here
The blueprint's MVP asks that a learner can "inspect a basic technical indicator". For a beginner an indicator is a way to *describe* what happened (the price has been above its 20-day average for 30 days), not a forecast. The product principle is to teach doubt, so every indicator is shown with a plain sentence about what it does and does not say.

## Key ideas
- Warm-up: an N-day average has no value for the first N-1 days. Show nothing there; do not fill with zeros.
- Causality test: compute the indicator on the first k bars and on all bars; the first k values must be identical (the truncation test already used for the Sprint 03 engine).
- RSI variants differ (Wilder smoothing versus simple means). Choose one, name it, test it against a hand-computed example.
- An indicator on a blind episode may use only the bars the learner can already see.

## Common mistakes
Using a centred window (looks into the future); filling warm-up values; calling a crossing a "signal to buy"; hiding which RSI variant was used.

## Check yourself
1. Why must the first 10 values of a 5-day average on 10 bars equal the first 10 values on 500 bars? 2. What does an RSI of 70 describe? What does it not say?

## References
- Moving average: https://en.wikipedia.org/wiki/Moving_average (verified reachable 2026-11-10)
- Relative strength index: https://en.wikipedia.org/wiki/Relative_strength_index (verified reachable 2026-11-10)
- Technical analysis (including its criticism): https://en.wikipedia.org/wiki/Technical_analysis (verified reachable 2026-11-10)
