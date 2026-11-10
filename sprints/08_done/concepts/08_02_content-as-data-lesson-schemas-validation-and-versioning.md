# Content as data: lesson schemas, validation and versioning

**Sprint:** 08    **Used by tasks:** 08_02, 08_03, 08_07

## Why this matters for MarketLab
Lessons are text that changes more often than code. If they live inside React components, every wording fix needs a build, reading-ease checks cannot cover them, and a typo in a quiz answer ships silently. Keeping them as validated data (as the glossary already is) lets tests check every lesson before it reaches a learner.

## Plain-language explanation
A **schema** says what a valid lesson looks like: an id, a title, 4 to 6 steps, each step with a heading and a body, and 3 questions with 2 to 4 options, exactly one marked correct, and an explanation for each option. A validator reads every lesson file and rejects any that break the rules. **Versioning** gives each lesson a number; when the text changes in a way that matters, the number goes up, so progress saved against version 1 can still be understood after version 2 exists.

Example: lesson `calibration` version 1 has a question with options A to D. If a later edit moves the correct answer to option C, a learner's saved answer "A" must not be read as the new "A". Saving the lesson version with each attempt avoids that.

## Key terms
- schema: a formal description of the shape and limits of data.
- validation: checking that data matches its schema before use.
- seed data: files in the repository that are loaded into the database by an idempotent script.
- idempotent: running it twice gives the same result as running it once.
- content version: a number that changes when the meaning of the content changes.

## Common mistakes / pitfalls
- Validating only in the browser. Validate when seeding and in tests.
- Letting two options be correct, or none.
- Editing a published question without changing the version, so old attempts are misread.
- Putting the answer key in a file served to the browser (see concept 08_03).
- Markup inside text that breaks the reading-ease checks; use the same `{{slug|label}}` markers as the screen copy.

## What to implement in this domain
- One JSON file per lesson under the gateway's seed folder, plus a JSON Schema and a seed script that validates and upserts into a table (`app.lesson`, `app.lesson_question`).
- A test that validates every lesson file, checks reading ease and sentence length of every text, checks that every `{{slug|label}}` marker resolves to a glossary term, and fails on a lesson with two correct options (negative test).
- A version number per lesson, stored with each learner attempt.

## How to check you understood
1. What does a schema check that a human reviewer might miss? (Exactly one correct option, counts of steps and options, required fields.)
2. Why store the lesson version with an attempt? (So an edited question is not mistaken for the old one.)
3. Why seed by an idempotent script? (Running it again after an edit must update, not duplicate.)

## References
- [JSON Schema: reference documentation](https://json-schema.org/understanding-json-schema/): an index of the keywords for describing and validating JSON (the page is a reference index; topic pages are linked from it; opened 2026-11-09).
- [Ajv documentation](https://ajv.js.org/): the validator already used in MarketLab's contract tests (opened 2026-11-09).
- [PostgreSQL: INSERT ... ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html): the upsert used to make seeding idempotent (read 2026-11-09).
- MarketLab `apps/api/scripts/seed-glossary.ts` (the existing idempotent seed) and concept 06_07.
