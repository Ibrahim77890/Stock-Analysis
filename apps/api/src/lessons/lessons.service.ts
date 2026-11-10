import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { Limiter } from "../limits/db-rate-limiter";
import { TooManyRequests } from "../lab/lab.service";

export const LESSON_ANSWER_LIMITER = "LESSON_ANSWER_LIMITER";
const NOT_FOUND = "That lesson was not found.";
/** After this many wrong answers to one question, the reply shows the right option. */
export const REVEAL_AFTER_WRONG = 2;

interface LessonRow { slug: string; version: number; title: string; summary: string; minutes: number; position: number; content: { steps: any[] } }

@Injectable()
export class LessonsService {
  constructor(private readonly db: DbService, @Inject(LESSON_ANSWER_LIMITER) private readonly limiter: Limiter) {}

  private async lesson(slug: string): Promise<LessonRow> {
    if (!/^[a-z0-9-]{1,60}$/.test(slug)) throw new NotFoundException(NOT_FOUND);
    const r = await this.db.query<LessonRow>("SELECT slug, version, title, summary, minutes, position, content FROM app.lesson WHERE slug = $1", [slug]);
    if (!r.rows[0]) throw new NotFoundException(NOT_FOUND);
    return r.rows[0];
  }

  private num(raw: string): number {
    if (!/^\d{1,3}$/.test(raw)) throw new NotFoundException(NOT_FOUND);
    return Number(raw);
  }

  async list(learnerId: string) {
    const r = await this.db.query(
      `SELECT l.slug, l.version, l.title, l.summary, l.minutes, l.position,
              jsonb_array_length(l.content->'steps') AS steps_total,
              (SELECT count(*)::int FROM app.lesson_question q WHERE q.lesson_slug = l.slug) AS questions_total,
              (SELECT count(*)::int FROM app.lesson_progress p WHERE p.learner_id = $1 AND p.lesson_slug = l.slug
                  AND p.step <= jsonb_array_length(l.content->'steps')) AS steps_read,
              (SELECT count(DISTINCT a.question_position)::int FROM app.quiz_answer a
                 JOIN app.lesson_question q ON q.lesson_slug = a.lesson_slug AND q.position = a.question_position
                WHERE a.learner_id = $1 AND a.lesson_slug = l.slug AND a.correct) AS questions_right
         FROM app.lesson l ORDER BY l.position`,
      [learnerId],
    );
    return r.rows.map((x) => ({
      slug: x.slug, position: x.position, version: x.version, title: x.title, summary: x.summary, minutes: x.minutes,
      steps_total: x.steps_total, steps_read: x.steps_read, questions_total: x.questions_total, questions_right: x.questions_right,
      done: x.steps_total > 0 && x.steps_read >= x.steps_total && x.questions_total > 0 && x.questions_right >= x.questions_total,
    }));
  }

  async detail(learnerId: string, slug: string) {
    const l = await this.lesson(slug);
    const [qs, read, att] = await Promise.all([
      this.db.query("SELECT position, prompt, options FROM app.lesson_question WHERE lesson_slug = $1 ORDER BY position", [slug]),
      this.db.query("SELECT step FROM app.lesson_progress WHERE learner_id = $1 AND lesson_slug = $2 AND step <= $3 ORDER BY step", [learnerId, slug, l.content.steps.length]),
      this.db.query(
        `SELECT question_position, count(*)::int AS attempts, bool_or(correct) AS right
           FROM app.quiz_answer WHERE learner_id = $1 AND lesson_slug = $2 GROUP BY question_position`,
        [learnerId, slug],
      ),
    ]);
    const attempts = new Map<number, { attempts: number; right: boolean }>(att.rows.map((a) => [a.question_position, { attempts: a.attempts, right: a.right }]));
    const questions = qs.rows.map((q) => ({
      position: q.position, prompt: q.prompt,
      options: (q.options as Array<{ text: string }>).map((o) => o.text), // texts only: no verdicts, no explanations
      answered_right: attempts.get(q.position)?.right ?? false, attempts: attempts.get(q.position)?.attempts ?? 0,
    }));
    const steps = l.content.steps.map((s) => ({ head: s.head, body: s.body, ...(s.more ? { more: s.more } : {}), ...(s.demo ? { demo: s.demo } : {}) }));
    const stepsRead = read.rows.map((r) => r.step as number);
    const right = questions.filter((q) => q.answered_right).length;
    return {
      slug: l.slug, position: l.position, version: l.version, title: l.title, summary: l.summary, minutes: l.minutes,
      steps_total: steps.length, steps_read: stepsRead.length, questions_total: questions.length, questions_right: right,
      done: stepsRead.length >= steps.length && questions.length > 0 && right >= questions.length,
      steps, questions, steps_read_list: stepsRead,
    };
  }

  async markRead(learnerId: string, slug: string, rawStep: string) {
    const l = await this.lesson(slug);
    const step = this.num(rawStep);
    const total = l.content.steps.length;
    if (step < 1 || step > total) throw new NotFoundException(NOT_FOUND);
    await this.db.query(
      "INSERT INTO app.lesson_progress (learner_id, lesson_slug, step) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
      [learnerId, slug, step],
    );
    const n = await this.db.query("SELECT count(*)::int AS n FROM app.lesson_progress WHERE learner_id = $1 AND lesson_slug = $2 AND step <= $3", [learnerId, slug, total]);
    return { lesson_slug: slug, step, steps_read: n.rows[0].n, steps_total: total };
  }

  async answer(learnerId: string, slug: string, rawQuestion: string, option: number) {
    await this.lesson(slug);
    const pos = this.num(rawQuestion);
    const q = await this.db.query("SELECT version, options FROM app.lesson_question WHERE lesson_slug = $1 AND position = $2", [slug, pos]);
    if (!q.rows[0]) throw new NotFoundException(NOT_FOUND);
    const options = q.rows[0].options as Array<{ text: string; why: string; correct: boolean }>;
    if (!Number.isInteger(option) || option < 0 || option >= options.length) {
      throw new UnprocessableEntityException("Please choose one of the options.");
    }
    if (!(await this.limiter.allow(learnerId))) {
      const wait = await this.limiter.retryAfterSeconds(learnerId);
      throw new TooManyRequests(`You are going a little fast. Please wait ${wait} seconds before the next answer.`, wait);
    }
    const chosen = options[option];
    const rightIndex = options.findIndex((o) => o.correct);
    // The attempt is appended and the counts are read in one statement.
    const r = await this.db.query(
      `WITH ins AS (
         INSERT INTO app.quiz_answer (learner_id, lesson_slug, question_position, lesson_version, option_index, correct)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING correct
       )
       SELECT (SELECT count(*)::int FROM app.quiz_answer WHERE learner_id = $1 AND lesson_slug = $2 AND question_position = $3 AND NOT correct) AS wrong_so_far,
              (SELECT bool_or(correct) FROM app.quiz_answer WHERE learner_id = $1 AND lesson_slug = $2 AND question_position = $3) AS right_any`,
      [learnerId, slug, pos, q.rows[0].version, option, chosen.correct],
    );
    // The statement cannot see its own insert in the sub-selects, so add this attempt to the counts here.
    const wrong = (r.rows[0].wrong_so_far as number) + (chosen.correct ? 0 : 1);
    const answeredRight = Boolean(r.rows[0].right_any) || chosen.correct;
    const reveal = chosen.correct || wrong >= REVEAL_AFTER_WRONG;
    return {
      correct: chosen.correct, why: chosen.why,
      ...(reveal ? { correct_option: rightIndex } : {}),
      wrong_so_far: wrong, answered_right: answeredRight,
    };
  }
}
