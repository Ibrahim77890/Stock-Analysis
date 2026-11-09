# Learning design for beginners: worked examples, retrieval practice and feedback

**Sprint:** 08    **Used by tasks:** 08_02, 08_05, 08_06

## Why this matters for MarketLab
Sprints 06 and 07 built tools that show how easy it is to fool yourself, but a newcomer meets them with no path: which idea first, how to know they understood. A lesson path that explains one idea, asks one small question and gives honest feedback turns the tools into learning. Without it the app is a set of screens that an expert can use and a beginner can only poke at.

## Plain-language explanation
Three habits make short lessons work.
- **One idea at a time.** A learner's working memory is small. Each lesson step teaches one idea with one example, and hides the rest behind "Show more" (progressive disclosure).
- **Retrieval practice.** Trying to recall an answer helps memory more than re-reading it. After each lesson, a few questions ("When you said 70%, how often should you be right?") ask the learner to produce the answer before seeing it. This is sometimes called the testing effect.
- **Feedback that explains.** A wrong answer should say why the right answer is right, in one or two plain sentences, and let the learner try again. A bare "wrong" teaches nothing.

Example: a lesson on calibration shows a 70% guess, asks "If you say 70% on 10 guesses, about how many should go up?" The learner picks 7, sees "Right: 70% means about 7 of 10", and moves on. If they pick 10, the feedback says "10 would mean you are certain. 70% means you expect to be wrong about 3 times in 10."

## Key terms
- worked example: a fully explained example shown before the learner tries their own.
- retrieval practice (testing effect): recalling information from memory, which strengthens it more than re-reading.
- progressive disclosure: showing only the first-needed information and deferring advanced details.
- cognitive load: the mental effort a task needs; extraneous load comes from how the material is presented and should be minimised.
- formative feedback: feedback given while learning, to guide the next try, not a grade.

## Common mistakes / pitfalls
- Long lessons with many ideas; a quiz that tests trivia instead of the one idea.
- Feedback that only says correct or incorrect.
- Scoring learners or ranking them; the product teaches doubt, not competition. Progress is a record, not a grade.
- Teaching the answer in the question wording, so nothing is retrieved.
- Treating the educational claims here as settled for every learner: the evidence for these methods is solid in general, but this app has not measured whether its own lessons work.

## What to implement in this domain
- Six lessons of 4 to 6 short steps each; every step has one idea, an example and an optional "Show more".
- Each lesson ends with 3 questions of one type (single choice), each with an explanation for every option.
- Plain-language rules from Sprint 06 apply (reading ease 60 or more, sentences up to 25 words); a lesson never promises profit.
- Progress is kept per learner and is never shown to anyone else.

## How to check you understood
1. Why ask a question before showing the answer? (Recalling strengthens memory more than re-reading.)
2. A learner answers wrongly. What must the page show? (Why the right answer is right, and a way to try again.)
3. Why is a lesson step limited to one idea? (Working memory is small; extra ideas add load that does not help learning.)

## References
- [Wikipedia: Testing effect](https://en.wikipedia.org/wiki/Testing_effect): describes retrieval practice and its evidence (read 2026-11-09, first 100,000 characters).
- [Wikipedia: Cognitive load](https://en.wikipedia.org/wiki/Cognitive_load): intrinsic, extraneous and germane load (read 2026-11-09, first 100,000 characters).
- [Nielsen Norman Group: Progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/): why advanced details are deferred (read 2026-11-09).
- [The Learning Scientists: Retrieval practice](https://www.learningscientists.org/retrieval-practice): a landing page that links posters and a video; the content is behind those links (page opened 2026-11-09; the linked material was not read).
- MarketLab concept 06_08 (plain language and progressive disclosure) and `docs/02-domain/learning-loop.md`.
