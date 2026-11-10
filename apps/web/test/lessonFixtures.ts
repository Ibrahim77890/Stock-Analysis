import type { AnswerResult, LessonDetail, LessonSummary } from "../src/api/client";

export function summary(over: Partial<LessonSummary> = {}): LessonSummary {
  return {
    slug: "reading-candles", position: 1, version: 1, title: "Reading a candle chart", summary: "What one candle shows.", minutes: 4,
    steps_total: 5, steps_read: 0, questions_total: 3, questions_right: 0, done: false, ...over,
  };
}

export const PATH: LessonSummary[] = [
  summary({ done: true, steps_read: 5, questions_right: 3 }),
  summary({ slug: "what-a-guess-means", position: 2, title: "What a probability guess means", steps_read: 2, questions_right: 1 }),
  summary({ slug: "brier-score", position: 3, title: "The Brier score" }),
  summary({ slug: "calibration", position: 4, title: "Calibration and few guesses" }),
  summary({ slug: "luck-and-many-tries", position: 5, title: "Luck and trying many ideas" }),
  summary({ slug: "costs-and-the-vault", position: 6, title: "Costs, buy and hold, and the vault" }),
];

export function lessonDetail(over: Partial<LessonDetail> = {}): LessonDetail {
  return {
    ...summary({ slug: "what-a-guess-means", position: 2, title: "What a probability guess means", steps_total: 3 }),
    steps: [
      { head: "A guess with a number", body: "A {{guess|guess}} of 70% means likely, not sure." },
      { head: "What 70% says", body: "About 3 times in 10 you should be wrong.", more: "This is extra detail.", demo: "chance-70" },
      { head: "Small numbers fool us", body: "A few guesses tell you very little." },
    ],
    questions: [
      { position: 1, prompt: "You say 70% ten times. How often are you wrong?", options: ["About 3 times", "Never", "About 7 times"], answered_right: false, attempts: 0 },
      { position: 2, prompt: "Was one miss a bad guess?", options: ["Not by itself", "Yes"], answered_right: false, attempts: 0 },
    ],
    questions_total: 2, steps_read_list: [],
    ...over,
  } as LessonDetail;
}

export const wrong = (why = "Only 100% means never wrong.", over: Partial<AnswerResult> = {}): AnswerResult =>
  ({ correct: false, why, wrong_so_far: 1, answered_right: false, ...over });
export const right = (why = "Yes. 70% means wrong about 3 times in 10.", over: Partial<AnswerResult> = {}): AnswerResult =>
  ({ correct: true, why, correct_option: 0, wrong_so_far: 0, answered_right: true, ...over });
