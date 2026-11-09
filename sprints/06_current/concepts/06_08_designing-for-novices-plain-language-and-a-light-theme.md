# Designing for novices: plain language, progressive disclosure and a light theme

**Sprint:** 06    **Used by tasks:** 06_07, 06_08, 06_09, 06_10, 06_11, 06_12

## Why this matters for MarketLab
The users are beginners who do not know what a "close", a "horizon" or a "Brier score" is. A correct but jargon-heavy screen teaches nothing and invites wrong conclusions. The product principle is to teach distrust of results, so every number must come with a sentence a newcomer can read, and the page must show what the system is doing instead of hiding it.

## Plain-language explanation
- **Plain language**: short sentences, everyday words, one idea per sentence, the reader addressed as "you", terms defined where they first appear. Aim for a reading level of about grade 8 or lower. Example: not "Calibrate your ex-ante probabilistic forecasts", but "When you say 70%, it should happen about 7 times out of 10."
- **Progressive disclosure**: show the few things a beginner needs now and let them open the rest. The episode screen first shows the chart, one button to advance and one question to answer; extras (relative volume, the "Under the hood" panel, the numbers behind the plot) sit behind labelled "Show more" controls.
- **Term help**: every technical word on screen (close, candle, horizon, probability, Brier score, calibration, reveal) is a button that opens a short definition from the glossary, which is stored as data (blueprint 23.4) and served by NestJS.
- **A guided first run**: a short tour (4 to 6 steps) explains the chart, the question, the commit rule ("you cannot change an answer") and the score; it can be skipped and reopened.
- **Show the state**: the page always says where you are ("Episode 3, day 87 of 250"), what was hidden ("the name, dates and price level are hidden until you reveal"), and what happens next. A beginner should never wonder whether a click did something.
- **Light theme only for now**: a single light palette defined once as design tokens (background, surface, text, muted text, border, accent, up, down, warning, focus ring). `color-scheme: light` is declared and there is no dark-mode media query in this sprint. Contrast: normal text at least 4.5:1, large text and interface components at least 3:1; up and down are never distinguished by colour alone (add an arrow or the words "up"/"not up").
- **Mechanics vs interpretation** (blueprint 23.4): facts about how the score is computed are visually separated from what a result might mean, and results are always worded "in this sample".

Example of a good score line: "Your score: 0.23. Guessing 50% every time gives 0.25, so you did a little better than guessing. With only 12 answers this could easily be luck."

## Key terms
- plain language: wording a newcomer understands on first reading.
- progressive disclosure: revealing detail on demand.
- design token: a named value (colour, spacing, size) used everywhere instead of hard-coded numbers.
- contrast ratio: luminance ratio between text and its background.
- coach mark / tour: short guided explanation attached to parts of the screen.
- empty state: what a screen says when there is nothing to show yet.

## Common mistakes / pitfalls
- Defining a term only in the documentation instead of on the screen.
- Explaining with more jargon ("Brier score is the mean squared error of probabilistic forecasts").
- Colour-only signals (green/red candles with no label), pale grey text on white.
- Modal pop-ups that interrupt the task; prefer inline help.
- Claiming certainty ("you are skilled/unskilled") from a small sample.
- Adding dark mode "for later" in styles now: it doubles the contrast checks. Keep one palette.

## What to implement in this domain
- One CSS file of light-theme tokens and a small component set (Button, Card, Callout, Term, Stat, Stepper, Tour) used by all screens.
- A `Term` component that opens a glossary definition; the glossary served by NestJS.
- A copy guide in the repo (short list of rules, reading-level check on all screen text with a simple Flesch reading-ease script, target 60 or higher).
- Empty, loading and error states with plain sentences.

## How to check you understood
1. Rewrite "Reliability diagram of ex-ante forecasts" for a beginner. (For example: "Did your 70% answers come true about 70% of the time?")
2. Why is "green means up" not enough? (Some users cannot tell the colours apart; add a shape or the word "up".)
3. Why keep one theme now? (Every extra theme multiplies contrast and layout checks; light-only keeps the first release testable.)

## References
- [Nielsen Norman Group: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): definition and why it helps novices (read 2026-11-09).
- [Digital.gov: Plain language](https://digital.gov/guides/plain-language): what plain language is (read 2026-11-09; the page defines it and links to detailed guides, which were not read).
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): contrast (1.4.3), non-text contrast (1.4.11), use of colour (1.4.1) (read 2026-11-09).
- [Wikipedia: Flesch-Kincaid readability tests](https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_tests) (unverified): formula for the reading-ease score used by the copy check.
- MarketLab blueprint 23.4 (learning-experience design: glossary as data, mechanics vs interpretation, small mastery checks).
