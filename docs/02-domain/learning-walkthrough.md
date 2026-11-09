# Learning loop: hand walkthrough (14 steps)

Follow these steps in a browser to check the learning loop by hand. Each step says what you should see. **Before you start:** run the three parts (see `system-overview.md`, "Start everything"): the Python service on port 8000, the gateway on port 3000 (`npm start` in `apps/api`) and the web app (`npm run dev` in `apps/web`), then open http://127.0.0.1:5173.

| # | Step | What you should see |
|---|---|---|
| 1 | Open the home page. | "Learn to doubt your own guesses", three cards, a "Careful" note that it is for learning only. A footer with the TradingView credit and "Not investment advice". |
| 2 | Create an account: a name and a password of 10 or more characters (the rules are written above the fields). | You land on a page with a short tour. |
| 3 | In the tour, click the dotted word "candle". | A plain explanation opens under the word, with an example. Press Escape: it closes. |
| 4 | Go through the tour to the end ("Next", then "Got it"). | The tour disappears. "Need help?" at the top reopens it. |
| 5 | Open Learn, keep "Let MarketLab surprise me" and choose six months, press Start. | A candle chart with "Day 60 of 120", a three-step coach (1 Look, 2 Guess, 3 Move on) and the sentence "name, dates and price level still hidden". |
| 6 | Read the page. | No name, no dates, no years, no ticker anywhere. The price axis says "Price (starts at 100)". |
| 7 | Choose "In 5 days", set 65%, press "Send my guess". | The sentence "6.5 out of 10 times I would be right about higher"; the coach moves to step 3; the guess appears as "Waiting". |
| 8 | Press "Send my guess" again with the same choices. | "You already sent this guess." No second row. |
| 9 | Press "5 days". | The guess becomes "Answered" with "The price went up" or "did not go up" and "You were right" or "You were off"; a tip says one guess tells you almost nothing. |
| 10 | Reload the page. | The same episode, the same day and the same guess are still there. |
| 11 | Press "Finish and see my score", then "Show my score". | A score, a meter with the "Guessing (0.25)" line, a "Too few guesses" notice, a calibration plot with a table. No better-or-worse claim. |
| 12 | Press "Reveal what it was", then "Yes, reveal it". | "This was a real stock" (name, symbol, dates, data trail, licence note) or "This was a made-up chart"; a list of what the score does not tell you. |
| 13 | Open "How does this work?". | A diagram of the four parts, three status lights in words ("running"), what the server hides and keeps, and your recent requests in words ("Moved the episode forward"). |
| 14 | Use only the keyboard on the Learn page. | Tab reaches the menu, the help button, the choices and the Start button, with a visible focus outline. |

## Result of the run on 2026-11-09 (automated Edge browser, run by the implementer)
The 14 steps above were driven in Microsoft Edge (headless, via `puppeteer-core`, script kept outside the repository) against the real stack: gateway, Python service and the real database. **All 14 passed** (step 9 on the last run: "Answered, The price went up. You were right"; step 12: a made-up chart; step 13 listed "Moved the episode forward"; browser console: no errors or warnings). Time per step was 0.3 to 2.8 seconds. The first run **failed steps 2 to 4**: the guided tour did not open after creating an account (the layout decided whether to show it before sign-in); fixed in `components/Layout.tsx` and covered by a test. A favicon 404 in the console was also fixed.

**Not done:** a person who did not build the app has **not** yet followed this walkthrough. The implementer's own run (and an automated one) cannot show where a beginner hesitates or misreads a word, which is the point of the check. This is recorded in `sprints/06_current/pending/`: ask one person to follow the 14 steps without help, note per step pass/fail, how long it took and every hesitation, then fix wording or layout.

## Accessibility pass (measured 2026-11-09)
- **Keyboard only:** step 14 passed (Tab order: MarketLab, Learn, My progress, Words, How does this work?, Need help?, Sign out, then the form controls). Steps 3 to 9 were completed with mouse clicks in the automated run; keyboard-only completion of steps 3 to 9 is covered by component tests (Enter opens a word, Escape closes it, the right-arrow key moves one day) but was **not** driven end to end with the keyboard in a browser.
- **Contrast** (WCAG ratios computed from the design tokens): text on page 14.84:1, text on cards 15.79:1, muted text 7.53:1, links and buttons 6.09:1, info note 11.09:1, careful note 8.95:1, up 7.02:1, down 7.66:1; component borders 3.64:1 and focus ring 6.39:1. All at least 4.5:1 for text and 3:1 for components. (An earlier border colour measured 2.09:1 and was darkened after the test failed.)
- **Reading ease** (Flesch, all screen text in `src/copy`, with word markers replaced by their label): home 99, learn 97, score 94, how-it-works 90; longest sentence 22 words (limit 25). The threshold is 60.
- **Screen readers:** not tested with a screen reader. The chart and the calibration plot have text alternatives (a table of the last 10 days; a table of the plotted numbers linked with `aria-describedby`); the accessibility tree was not inspected in a browser.
