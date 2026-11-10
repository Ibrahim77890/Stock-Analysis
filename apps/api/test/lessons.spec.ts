import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { glossarySlugs, loadValidLessons, seedLessons } from "../scripts/seed-lessons";
import { LessonFile } from "../src/lessons/content";
import { auth, HAS_DB, Harness, register, resetAppTables, startApp } from "./helpers";

const SLUGS = ["reading-candles", "what-a-guess-means", "brier-score", "calibration", "luck-and-many-tries", "costs-and-the-vault"];
const NOT_FOUND = { statusCode: 404, message: "That lesson was not found." };

describe.skipIf(!HAS_DB)("lessons gateway (database, fake Python)", () => {
  let h: Harness;
  let lessons: LessonFile[];
  beforeAll(async () => {
    h = await startApp();
    lessons = loadValidLessons();
    await h.pool.query("TRUNCATE app.lesson CASCADE");
    await seedLessons(h.pool, lessons);
    void glossarySlugs;
  });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); });

  const keyOf = (slug: string, q: number) => {
    const l = lessons.find((x) => x.slug === slug)!;
    return l.questions[q - 1].options.findIndex((o) => o.correct);
  };
  const answer = (t: string, slug: string, q: number | string, option: unknown) =>
    h.http().post(`/lessons/${slug}/questions/${q}/answer`).set(auth(t)).send({ option });
  const read = (t: string, slug: string, n: number | string) => h.http().post(`/lessons/${slug}/steps/${n}/read`).set(auth(t)).send();

  it("needs a signed-in learner on every route", async () => {
    expect((await h.http().get("/lessons")).status).toBe(401);
    expect((await h.http().get("/lessons/brier-score")).status).toBe(401);
    expect((await h.http().post("/lessons/brier-score/steps/1/read")).status).toBe(401);
    expect((await h.http().post("/lessons/brier-score/questions/1/answer").send({ option: 0 })).status).toBe(401);
  });

  it("lists six lessons in order with zero progress for a new learner", async () => {
    const { token } = await register(h, "Ann");
    const r = await h.http().get("/lessons").set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.map((x: any) => x.slug)).toEqual(SLUGS);
    for (const x of r.body) expect(x).toMatchObject({ steps_read: 0, questions_right: 0, done: false, questions_total: 3 });
  });

  it("ANSWER-KEY LEAK: no lesson reply holds a verdict key, an explanation, or the text of any explanation", async () => {
    const { token } = await register(h, "Ann");
    const bodies = [JSON.stringify((await h.http().get("/lessons").set(auth(token))).body)];
    for (const s of SLUGS) bodies.push(JSON.stringify((await h.http().get(`/lessons/${s}`).set(auth(token))).body));
    const text = bodies.join("\n");
    expect(text).not.toMatch(/"correct"|"why"|correct_option/);
    for (const l of lessons) for (const q of l.questions) for (const o of q.options) expect(text).not.toContain(o.why);
  });

  it("the lesson reply has the option texts and the steps, with demo ids", async () => {
    const { token } = await register(h, "Ann");
    const r = await h.http().get("/lessons/what-a-guess-means").set(auth(token));
    expect(r.body.steps).toHaveLength(5);
    expect(r.body.steps[1].demo).toBe("chance-70");
    expect(r.body.questions[0].options).toEqual(lessons[1].questions[0].options.map((o) => o.text));
    expect(Object.keys(r.body.questions[0]).sort()).toEqual(["answered_right", "attempts", "options", "position", "prompt"]);
  });

  it("a first wrong answer gives the explanation of the chosen option and does NOT reveal the right option; the second wrong answer does", async () => {
    const { token } = await register(h, "Ann");
    const key = keyOf("brier-score", 1);
    const wrong = [0, 1, 2].filter((i) => i !== key);
    const a = await answer(token, "brier-score", 1, wrong[0]);
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ correct: false, why: lessons[2].questions[0].options[wrong[0]].why, wrong_so_far: 1, answered_right: false });
    expect("correct_option" in a.body).toBe(false);
    const b = await answer(token, "brier-score", 1, wrong[1]);
    expect(b.body.correct_option).toBe(key);
    expect(b.body.wrong_so_far).toBe(2);
    const c = await answer(token, "brier-score", 1, key);
    expect(c.body).toMatchObject({ correct: true, correct_option: key, answered_right: true });
  });

  it("a right answer counts once as progress however many times it is sent; every attempt is recorded with the lesson version", async () => {
    const { token, id } = await register(h, "Ann");
    const key = keyOf("calibration", 2);
    for (let i = 0; i < 3; i++) expect((await answer(token, "calibration", 2, key)).body.correct).toBe(true);
    const list = (await h.http().get("/lessons").set(auth(token))).body.find((x: any) => x.slug === "calibration");
    expect(list.questions_right).toBe(1);
    const rows = await h.pool.query("SELECT lesson_version, correct FROM app.quiz_answer WHERE learner_id = $1", [id]);
    expect(rows.rowCount).toBe(3);
    expect(rows.rows.every((r) => r.lesson_version === 1 && r.correct)).toBe(true);
  });

  it("20 concurrent identical answers: one question counted as right, 20 attempts, same verdict", async () => {
    const { token, id } = await register(h, "Ann");
    const key = keyOf("calibration", 1);
    const res = await Promise.all(Array.from({ length: 20 }, () => answer(token, "calibration", 1, key)));
    expect(new Set(res.map((r) => r.status))).toEqual(new Set([200]));
    expect(new Set(res.map((r) => r.body.correct))).toEqual(new Set([true]));
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.quiz_answer WHERE learner_id = $1", [id])).rows[0].n).toBe(20);
    const list = (await h.http().get("/lessons").set(auth(token))).body.find((x: any) => x.slug === "calibration");
    expect(list.questions_right).toBe(1);
  });

  it("marking a step read twice, and 20 times at once, leaves one row; progress counts equal the table", async () => {
    const { token, id } = await register(h, "Ann");
    expect((await read(token, "brier-score", 2)).body).toMatchObject({ step: 2, steps_read: 1, steps_total: 5 });
    expect((await read(token, "brier-score", 2)).body.steps_read).toBe(1);
    await Promise.all(Array.from({ length: 20 }, () => read(token, "brier-score", 3)));
    const rows = await h.pool.query("SELECT step FROM app.lesson_progress WHERE learner_id = $1 ORDER BY step", [id]);
    expect(rows.rows.map((r) => r.step)).toEqual([2, 3]);
    const d = (await h.http().get("/lessons/brier-score").set(auth(token))).body;
    expect(d.steps_read).toBe(2);
    expect(d.steps_read_list).toEqual([2, 3]);
    expect((await h.http().get("/lessons").set(auth(token))).body.find((x: any) => x.slug === "brier-score").steps_read).toBe(2);
  });

  it("a lesson is done only when every step is read and every question is answered rightly", async () => {
    const { token } = await register(h, "Ann");
    for (let n = 1; n <= 5; n++) await read(token, "reading-candles", n);
    for (let q = 1; q <= 2; q++) await answer(token, "reading-candles", q, keyOf("reading-candles", q));
    expect((await h.http().get("/lessons/reading-candles").set(auth(token))).body.done).toBe(false);
    await answer(token, "reading-candles", 3, keyOf("reading-candles", 3));
    const d = (await h.http().get("/lessons/reading-candles").set(auth(token))).body;
    expect(d.done).toBe(true);
    expect(d.questions.every((q: any) => q.answered_right)).toBe(true);
  });

  it("unknown or malformed identifiers all give the same 404 body; a bad option is 422", async () => {
    const { token } = await register(h, "Ann");
    const calls = [
      h.http().get("/lessons/nope").set(auth(token)),
      h.http().get("/lessons/NOPE%20x").set(auth(token)),
      read(token, "nope", 1), read(token, "brier-score", 0), read(token, "brier-score", 6), read(token, "brier-score", "abc"), read(token, "brier-score", "99999"),
      answer(token, "brier-score", 4, 0), answer(token, "brier-score", "x", 0), answer(token, "nope", 1, 0),
    ];
    for (const r of await Promise.all(calls)) {
      expect(r.status).toBe(404);
      expect(r.body).toMatchObject(NOT_FOUND);
    }
    for (const bad of ["a", -1, 1.5, null, 9, 3]) {
      const r = await answer(token, "brier-score", 1, bad);
      expect(r.status, `option ${String(bad)}`).toBe(422);
    }
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.quiz_answer")).rows[0].n).toBe(0);
  });

  it("ISOLATION FUZZ: two learners, 200 random attempts; each sees only their own progress", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); };
    const mine = { [a.id]: new Set<string>(), [b.id]: new Set<string>() } as Record<string, Set<string>>;
    for (let i = 0; i < 200; i++) {
      const who = rnd(2) === 0 ? a : b;
      const slug = SLUGS[rnd(6)], n = 1 + rnd(5);
      const r = await read(who.token, slug, n);
      expect(r.status).toBe(200);
      mine[who.id].add(`${slug}/${n}`);
    }
    for (const who of [a, b]) {
      const got = new Set<string>();
      for (const s of SLUGS) for (const n of (await h.http().get(`/lessons/${s}`).set(auth(who.token))).body.steps_read_list) got.add(`${s}/${n}`);
      expect(got).toEqual(mine[who.id]);
    }
  });

  it("the 61st answer in a minute is 429 with Retry-After; another learner is unaffected", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const codes: number[] = [];
    for (let i = 0; i < 61; i++) codes.push((await answer(a.token, "brier-score", 1, 0)).status);
    expect(codes.slice(0, 60).every((c) => c === 200)).toBe(true);
    const last = await answer(a.token, "brier-score", 1, 0);
    expect(last.status).toBe(429);
    expect(codes[60]).toBe(429);
    expect(Number(last.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect(last.body.message).toMatch(/wait \d+ seconds/);
    expect((await answer(b.token, "brier-score", 1, 0)).status).toBe(200);
    // refused calls are not stored: the learner has exactly 60 attempts
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.quiz_answer WHERE learner_id = $1", [a.id])).rows[0].n).toBe(60);
  });

  it("re-seeding: unchanged is reported; a changed lesson needs a higher version; old attempts keep their old version", async () => {
    const { token, id } = await register(h, "Ann");
    expect(await seedLessons(h.pool, lessons)).toMatchObject({ inserted: 0, updated: 0, unchanged: 6 });
    await answer(token, "brier-score", 1, keyOf("brier-score", 1));
    const changed: LessonFile[] = JSON.parse(JSON.stringify(lessons));
    changed[2].questions[0].prompt = changed[2].questions[0].prompt + " (reworded)";
    await expect(seedLessons(h.pool, changed)).rejects.toThrow(/Raise "version"/);
    changed[2].version = 2;
    expect(await seedLessons(h.pool, changed)).toMatchObject({ updated: 1, unchanged: 5 });
    await answer(token, "brier-score", 1, keyOf("brier-score", 1));
    const rows = await h.pool.query("SELECT lesson_version FROM app.quiz_answer WHERE learner_id = $1 ORDER BY answer_id", [id]);
    expect(rows.rows.map((r) => r.lesson_version)).toEqual([1, 2]);
    const list = (await h.http().get("/lessons").set(auth(token))).body.find((x: any) => x.slug === "brier-score");
    expect(list.version).toBe(2);
    expect(list.questions_right).toBe(1);
    // restore the original content for the next tests
    await h.pool.query("TRUNCATE app.lesson CASCADE");
    await seedLessons(h.pool, lessons);
  });

  it("the seeded database rows pass the same content checks as the files", async () => {
    const rows = await h.pool.query("SELECT l.slug, l.content, (SELECT json_agg(q.options ORDER BY q.position) FROM app.lesson_question q WHERE q.lesson_slug = l.slug) AS opts FROM app.lesson l ORDER BY position");
    expect(rows.rowCount).toBe(6);
    for (const r of rows.rows) {
      for (const opts of r.opts) expect((opts as any[]).filter((o) => o.correct)).toHaveLength(1);
      expect(r.content.steps.length).toBeGreaterThanOrEqual(4);
    }
  });
});
