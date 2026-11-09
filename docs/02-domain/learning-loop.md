# The learning loop (Sprint 06)

MarketLab's product principle is to teach people to **distrust their own results** (blueprint 23.1). The learning loop applies it to a person's own judgement: look at a hidden price chart, say how sure you are that the price will be higher soon, and see an honest score. Decisions: ADR 0014 (stack) and ADR 0015 (protocol). Scores: `scoring.md`. Architecture: `system-overview.md`. Hand check: `learning-walkthrough.md`.

## What a learner does (screens in words)
1. **Home** explains in three cards what happens and says clearly that MarketLab is for learning only.
2. **Create an account / sign in.** A name (2 to 40 characters) and a password (10 or more). The account stays on this computer. After the first sign-in a short **tour** explains the chart, the guess, the "no take-backs" rule, the score and the reveal; it can be skipped and reopened with "Need help?".
3. **Learn.** The learner picks real, made-up or "let MarketLab surprise me" (the default) and a length, then presses Start. The chart shows "Day 1..60" with the price starting at 100. A three-step **coach** (1 Look, 2 Guess, 3 Move on) says what to do next. Every technical word is a dotted button that opens a plain definition.
4. **Guess.** Choose how far ahead (next day, 5 days, 10 days) and how sure you are (1% to 99%); a sentence says what the number means ("7 out of 10"). Once sent, a guess cannot change.
5. **Move on.** "Next day" and "5 days" move the cursor; waiting guesses are answered when their day arrives and the list says, in words and with arrows, whether the price went up and whether the learner was right.
6. **Score.** A big number, a meter with the coin-flip line (0.25), counts of answered, waiting and not counted guesses, a calibration plot with a table, and, from 30 answered guesses, a luck check. Below 30 it says "too few guesses" and makes no claim.
7. **Reveal** (asks first, one way): real or made-up; for real episodes the name, symbol, real dates, the data trail (provider, adjustment, survivorship and licence notes) and a list of what the score does not tell you.
8. **My progress** and **How does this work?** (see below).

## Visibility ("Under the hood")
A diagram of the four parts (browser, NestJS front desk, Python number cruncher, PostgreSQL), live status lights in words, what the server hides and keeps for the current episode, the learner's own recent requests (what they did, which parts handled it, how long, and a result word; no ids, bodies or tokens), and a collapsed developer section with the schema-ownership table, migration names and Swagger links.

## What the score does and does not show
It shows, **in this sample**, how close the stated probabilities were to what happened, compared with guessing 50% every time. It does not show skill (a few guesses can be luck; below 30 nothing is claimed), a strategy, or anything about the future. Guesses about nearby days overlap. The stocks come from today's survivors. Nothing here is investment advice.

## Known limits
Famous crashes can be recognised from their shape even with name, dates and level hidden (the mixed real/made-up setting reduces this). Real charts are derived from Tiingo's free plan, which is for internal use only: use the app on this machine only and do not share it. The whole learning loop is single-user per machine in practice: accounts separate learners but there is no deployment story.
