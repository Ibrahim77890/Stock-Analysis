# Lessons (Sprint 08)

Six short lessons form the learning path (`/path` in the web app). Each teaches one idea in 4 to 5 steps and then asks three questions.

| # | Slug | Idea | Practised in |
|---|---|---|---|
| 1 | `reading-candles` | One candle shows one day; a row of candles is a past path, not a promise | Guess game |
| 2 | `what-a-guess-means` | 70% means wrong about 3 times in 10 (demo `chance-70`) | Guess game |
| 3 | `brier-score` | How a guess becomes a Brier score; 0.25 is the coin-flip line | Guess game |
| 4 | `calibration` | Do numbers match life; few guesses prove little | Guess game |
| 5 | `luck-and-many-tries` | Streaks by luck (`coin-streaks`), the best of many tries (`many-tries`), overfitting | Lab |
| 6 | `costs-and-the-vault` | Costs in basis points, buy and hold, the vault, what a backtest cannot tell you | Lab |

## The question rules
- Three questions per lesson, two to four options, exactly one right.
- A wrong answer is never shamed: the reply is "Not yet" plus the reason for the option chosen.
- The right option is shown only after the learner answered it rightly, or after a second wrong answer to the same question.
- The answer key stays in the database. Reads return option texts only.

## What progress means
Steps read (stored once each) and questions answered rightly at least once. A lesson is **done** when every step is read and every question has been answered rightly. It is private to the learner and is a record, not a grade. There are no scores, points, ranks, streaks or badges.

## How a lesson is written
One file per lesson in `apps/api/seed/lessons/<slug>.json`, checked against `lesson.schema.json`:
- `slug` (equals the file name), `position`, `version`, `title`, `summary`, `minutes` (3 to 8).
- `steps` (4 to 6): `head`, `body`, optional `more`, optional `demo` (`chance-70`, `coin-streaks`, `many-tries`).
- `questions` (3): `prompt`, `options` (`text`, `why`, `correct`).
- Glossary words are written as `{{slug|label}}`; every slug must exist (`docs/02-domain/glossary.md` or `apps/api/seed/learning-terms.json`; the glossary has 119 terms).
- Tests fail on jargon, long sentences, banned words, a missing glossary term, a wrong number of correct options. Run `npm run seed:lessons -- --validate-only`.
- Change a lesson: edit the file and raise `version`, then `npm run seed:lessons`. Old attempts keep their old version.
- The set hash of the six lessons (stored by the tests, printed by the seed script) is `121f34c3f7023dbc2d57da0d3fba69d56f3c8ab9a96c42cf7a9553883a62ce00`.

## Demos
Run in the browser on made-up data, seeded so a repeat gives the same picture, and never call the server. The best-of-50 demo uses seed 24 by default because on that seed the best rule's first-part result is far above its new-part result. On other seeds the effect can be smaller or reversed; a test shows this, and the page says "one seed shows nothing by itself".

## What the lessons do not claim
They do not give advice, promise a result or measure skill. They explain ideas and check that the idea was understood. Nobody has yet measured whether they help people learn, and no person outside the build has read them.
