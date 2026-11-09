# Explorable explanations: small demos that teach one idea

**Sprint:** 08    **Used by tasks:** 08_05, 08_06, 08_07

## Why this matters for MarketLab
Three ideas the product relies on are hard to feel from text: that "70%" means "wrong 3 times in 10", that a lucky streak is normal in noise, and that the best of many tries looks good by chance. A small demo the learner can move (a slider, a button that flips 100 coins) makes each one concrete in seconds, and costs no server work.

## Plain-language explanation
An **explorable explanation** is text with a small live model inside it. The reader changes a number and sees the effect at once. Good demos teach one idea, start from a sensible default, say what to look at, and are honest: a demo of luck uses a seeded random generator so the same button press gives the same result for everyone (testable) and says it is a simulation.

Three demos for this sprint:
1. **What 70% means.** A slider sets the chance; the page shows 20 outcomes drawn with a seed and the count that "went up". The learner sees that 70% still fails sometimes.
2. **Streaks in coin flips.** "Flip 100 coins" with a seed; the page marks the longest run of heads. Runs of 6 or 7 are normal.
3. **Many tries.** "Try 50 random rules" on seeded random data; the page shows the best one's result and then the same rule on fresh data. The best-of-50 falls back, which is the Lab's lesson in a toy.

## Key terms
- explorable explanation: text with embedded interactive models.
- seeded random generator: a pseudo-random sequence that is the same every time for the same seed.
- simulation: a model run on made-up data to show a pattern; it does not describe the market.
- default state: what the demo shows before the learner touches anything; it must already teach the point.

## Common mistakes / pitfalls
- A demo with many controls; each demo gets one or two.
- Random output that changes on every render (flicker, untestable).
- Teaching a wrong general rule from a lucky seed; choose and document seeds and add a "try another seed" button.
- Colour as the only signal; label what is shown and give a text summary.
- Mouse-only controls; sliders and buttons must work from the keyboard with visible focus.
- Presenting the demo as evidence about real markets.

## What to implement in this domain
- Three small React components (no new library; a tiny seeded generator such as mulberry32, with a unit test of its first values) under the web app, used inside lessons.
- Each demo has a one-sentence "what to look at", a text result (for example "14 of 20 went up"), and works with the keyboard.
- Tests: the same seed gives the same output; the text result matches the numbers drawn; the sliders have names; no demo calls the server.

## How to check you understood
1. Why seed the random generator? (Same output every time: testable and fair to every reader.)
2. What does demo 3 show, in one sentence? (The best of many random rules looks good by luck and falls back on new data.)
3. Why must the demo say it is a simulation? (It uses made-up data and says nothing about real prices.)

## References
- [Bret Victor: Explorable Explanations](https://worrydream.com/ExplorableExplanations/): the idea of reading as "an environment to think in" (read 2026-11-09).
- [W3C: ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/): keyboard patterns for sliders and buttons (home page opened 2026-11-09).
- MarketLab concepts 06_04 (luck and the permutation check) and 07_02 (trying many ideas).
