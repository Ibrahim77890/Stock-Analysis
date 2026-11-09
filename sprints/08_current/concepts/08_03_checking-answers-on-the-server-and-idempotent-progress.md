# Checking answers on the server and idempotent progress

**Sprint:** 08    **Used by tasks:** 08_03, 08_05, 08_07

## Why this matters for MarketLab
If the browser holds the answer key, any learner can read it in the network tab, and "retrieval practice" becomes copying. If progress is saved by a plain INSERT, a double click or a retry records the same answer twice and the counts drift. The gateway already owns learners and ownership (Sprint 06); this task adds the same discipline to quizzes.

## Plain-language explanation
- **Check on the server.** The browser receives the question and the options but not which option is correct. It sends the chosen option; the server answers "right" or "not yet" with the explanation for that option. The correct option is revealed only after an answer (so a learner who guessed wrong can try again, and one who got it right sees why).
- **Ownership.** A learner's progress rows are found by `learner_id`, never by a number in the URL alone; another learner's rows give the same 404 as a missing one. This prevents "insecure direct object reference" bugs.
- **Idempotent progress.** Saving "lesson done" or "answered question 2 correctly" uses a primary key `(learner_id, lesson_id, question_id)` and an upsert, so repeating the call changes nothing. Attempts are append-only in a separate table if the history matters.

Example: a learner double-clicks "Check". Two requests arrive. With an upsert on the primary key, one row exists afterwards; the second response is identical to the first.

## Key terms
- answer key: the data saying which option is correct.
- insecure direct object reference (IDOR): reaching another user's data by changing an id.
- idempotent: the same request repeated has the same effect as once.
- upsert: insert, or update if the key exists.
- append-only: rows are added, never changed.

## Common mistakes / pitfalls
- Sending `is_correct` with the options "for convenience".
- Revealing the answer in the error text of a wrong attempt before the learner has tried twice (decide a rule and test it).
- Counting every attempt as progress; progress is "answered correctly at least once".
- Returning different error bodies for "not yours" and "does not exist" (it leaks which ids exist).
- Rate limits missing on the check endpoint (a script could try all options in a second); keep the Sprint 07 limiter pattern.

## What to implement in this domain
- Gateway module `lessons`: list lessons with the learner's progress, get a lesson (no answer key), `POST .../questions/:id/answer` (returns correct or not, the explanation for the chosen option, and the correct option only when allowed by the rule), mark a lesson step read.
- Tables `app.lesson_progress` (primary key learner, lesson, step) and `app.quiz_answer` (append-only attempts, with lesson version).
- Tests: the answer key never appears in any lesson reply before an answer; a double answer leaves one progress row; another learner's progress is 404 with the same body; the answer endpoint is rate-limited.

## How to check you understood
1. Why must the browser not receive `is_correct`? (Anyone could read it from the response.)
2. What makes "mark done" safe to repeat? (A primary key plus an upsert.)
3. Why give "not yours" and "does not exist" the same answer? (So ids cannot be probed.)

## References
- [OWASP: Insecure Direct Object Reference Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Insecure_Direct_Object_Reference_Prevention_Cheat_Sheet.html): per-object access checks, scoping lookups to the current user (read 2026-11-09).
- [PostgreSQL: INSERT ... ON CONFLICT](https://www.postgresql.org/docs/current/sql-insert.html): upsert syntax (read 2026-11-09).
- MarketLab ADR 0014 (404 for other learners' objects, whitelisting) and ADR 0017 (the same pattern for studies).
