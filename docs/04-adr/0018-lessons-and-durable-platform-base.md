# ADR 0018: Lessons as validated data, server-side answer checking, durable limits

Status: accepted (Sprint 08)

## Context
Sprints 06 and 07 gave learners a blind guess loop and a Strategy Lab, but no path through them. Two parts of the gateway also lived only in memory: the rate limiter and the request trace. A restart reset every limit, and two simultaneous requests could both take the last slot.

## Decisions
1. **Lesson text is data.** Six JSON files in `apps/api/seed/lessons/` with a JSON Schema. Tests check every word: structure (4 to 6 steps, exactly 3 questions, exactly one right option), reading ease of 60 or more, sentences of at most 25 words, glossary markers that resolve, banned words, known demo ids. `npm run seed:lessons` loads them idempotently; a changed lesson must carry a higher `version`.
2. **The answer key never leaves the gateway database.** `GET /lessons` and `GET /lessons/:slug` return option texts only. An answer returns the verdict and the explanation of the **chosen** option. The right option's index is sent only when the answer was right, or after the second wrong answer to the same question. The read routes do not even use the words `correct` or `why` as field names, so a scan for the key has no false alarms.
3. **Progress is a record, not a grade.** Steps read and questions answered rightly at least once. No scores, points, ranks, streaks or badges: the product teaches doubt, not competition. Marking a step read is an idempotent upsert; every answer is appended to `app.quiz_answer` with the lesson version it was made against, so re-seeding never rewrites history.
4. **A quiz verdict is a lookup, not statistics,** so it lives in the gateway. Python computes everything numeric and is not involved.
5. **PostgreSQL holds the limits and the trace.** `app.rate_event` (key, kind, time) and `app.request_log`. One transaction per check takes an advisory lock for `(kind, key)`, counts rows in the last 60 seconds, and inserts only below the limit. Refused calls are not stored. Rows older than 10 minutes are removed at most once a minute and at start. The trace keeps 200 rows per learner and stores route patterns only. The old in-memory classes stay for unit tests with a fake clock.
6. **Demos are browser-only simulations** on made-up data (seeded, so repeatable). They never call the server and always say "made-up data".

## Rejected
- **Redis** for limits: new infrastructure, excluded by the project rules; PostgreSQL is enough on one machine (measured in benchmark 04).
- **Checking answers in the browser, or sending a signed answer key:** the key would reach every learner. A server-side lookup costs about 12 ms (benchmark 05).
- **A lesson editor or a CMS:** files plus tests are reviewable and reproducible; there is one author.
- **Scores, badges, streaks, leaderboards:** they reward speed and confidence, which is the opposite of what the lessons teach.
- **Per-IP limits:** nothing sits behind a proxy yet; keys are learner or client-and-name.

## Consequences
- Each limited call costs one database transaction (about 3 ms median on the development machine, see benchmark 04).
- A trace write that fails never fails a request; the write happens after the reply.
- If the database is unreachable, limited calls fail instead of being let through.
- Nobody has measured whether the lessons help people learn. They explain ideas and check understanding, not skill.
