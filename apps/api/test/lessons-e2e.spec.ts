import Ajv from "ajv";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadValidLessons, seedLessons } from "../scripts/seed-lessons";
import { LessonFile } from "../src/lessons/content";
import { repoRoot } from "../src/config/paths";
import { HAS_DB, Harness, register, resetAppTables, startApp } from "./helpers";

const ROOT = repoRoot();
const SLUGS = ["reading-candles", "what-a-guess-means", "brier-score", "calibration", "luck-and-many-tries", "costs-and-the-vault", "indicators-and-decisions"];

// ---- contract validation (extra fields are errors)
function strict(node: any): any {
  if (Array.isArray(node)) return node.map(strict);
  if (node && typeof node === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(node)) out[k] = strict(v);
    if (out.type === "object" && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  }
  return node;
}
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(strict(JSON.parse(fs.readFileSync(path.join(ROOT, "docs/02-domain/openapi-gateway.json"), "utf8"))), "doc");
const validates = (schema: string, body: unknown): string[] => {
  const v = ajv.getSchema(`doc#/components/schemas/${schema}`);
  if (!v) throw new Error(`no schema ${schema}`);
  return v(body) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

/**
 * The answer-key scan. `kind` says which route made the reply.
 * - lesson reads (list, detail): no "correct" or "why" key, no correct_option, no text of any explanation.
 * - answers: the "why" must be the chosen option's own; correct_option only when right or after the second wrong answer.
 * Scan exemptions (each one is tested below): the word "why" inside a question prompt is ordinary text, so only the JSON KEY is scanned.
 */
export function keyFindings(
  label: string, kind: "read" | "answer", body: unknown, headers: Record<string, unknown>, lessons: LessonFile[],
  ctx?: { lesson: LessonFile; q: number; option: number },
): string[] {
  const out: string[] = [];
  const text = JSON.stringify(body) + "\n" + JSON.stringify(headers);
  const allWhy = lessons.flatMap((l) => l.questions.flatMap((q) => q.options.map((o) => o.why)));
  if (kind === "read") {
    if (/"correct"|"why"|correct_option/.test(text)) out.push(`${label}: answer-key field in a read reply`);
    for (const w of allWhy) if (text.includes(w)) out.push(`${label}: an explanation text in a read reply`);
    return out;
  }
  const b = body as any;
  const opts = ctx!.lesson.questions[ctx!.q - 1].options;
  const chosen = opts[ctx!.option];
  if (b.why !== chosen.why) out.push(`${label}: why is not the chosen option's`);
  for (const w of allWhy) if (w !== chosen.why && text.includes(w)) out.push(`${label}: another explanation appears`);
  const hasKey = "correct_option" in b;
  if (hasKey && !(b.correct || b.wrong_so_far >= 2)) out.push(`${label}: right option revealed too early`);
  if (hasKey && opts[b.correct_option]?.correct !== true) out.push(`${label}: revealed option is not the right one`);
  if (!hasKey && (b.correct || b.wrong_so_far >= 2)) out.push(`${label}: right option missing when it should be shown`);
  if (/"correct"\s*:\s*(true|false)/.test(JSON.stringify(headers))) out.push(`${label}: key in headers`);
  return out;
}

describe.skipIf(!HAS_DB)("lessons on the real HTTP stack (database, real server, fake Python)", () => {
  let h: Harness;
  let base: string;
  let lessons: LessonFile[];
  beforeAll(async () => {
    h = await startApp();
    await h.app.listen(0, "127.0.0.1");
    base = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
    lessons = loadValidLessons();
    await h.pool.query("TRUNCATE app.lesson CASCADE");
    await seedLessons(h.pool, lessons);
  });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); });

  const call = async (token: string, method: "GET" | "POST", p: string, body?: object) => {
    const res = await fetch(base + p, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : method === "POST" ? "{}" : undefined });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json, headers };
  };

  it("ANSWER-KEY LEAK FUZZ: 7 lessons x every option x random order x 3 learners; every reply and header scanned; contracts validate", async () => {
    const learners = [await register(h, "Ann"), await register(h, "Bob"), await register(h, "Cy")];
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); };
    let scanned = 0;
    const findings: string[] = [];
    for (const who of learners) {
      const list = await call(who.token, "GET", "/lessons");
      findings.push(...keyFindings("list", "read", list.body, list.headers, lessons));
      expect(validates("LessonSummaryDto", list.body[0])).toEqual([]);
      const order = SLUGS.map((s) => ({ s, k: rnd(1000) })).sort((a, b) => a.k - b.k).map((x) => x.s);
      for (const slug of order) {
        await h.pool.query("DELETE FROM app.rate_event"); // a learner sends more than 60 answers in this loop, which the limit would refuse
        const lesson = lessons.find((l) => l.slug === slug)!;
        const detail = await call(who.token, "GET", `/lessons/${slug}`);
        findings.push(...keyFindings(`detail ${slug}`, "read", detail.body, detail.headers, lessons));
        expect(validates("LessonDetailDto", detail.body), slug).toEqual([]);
        for (let q = 1; q <= 3; q++) {
          const optionOrder = lesson.questions[q - 1].options.map((_, i) => ({ i, k: rnd(1000) })).sort((a, b) => a.k - b.k).map((x) => x.i);
          for (const option of optionOrder) {
            const r = await call(who.token, "POST", `/lessons/${slug}/questions/${q}/answer`, { option });
            expect(r.status).toBe(200);
            expect(validates("AnswerResultDto", r.body)).toEqual([]);
            findings.push(...keyFindings(`${slug} q${q} o${option}`, "answer", r.body, r.headers, lessons, { lesson, q, option }));
            scanned++;
          }
        }
        const after = await call(who.token, "GET", `/lessons/${slug}`);
        findings.push(...keyFindings(`detail-after ${slug}`, "read", after.body, after.headers, lessons));
        const rd = await call(who.token, "POST", `/lessons/${slug}/steps/1/read`);
        expect(validates("StepReadDto", rd.body)).toEqual([]);
      }
    }
    expect(scanned).toBeGreaterThan(150);
    expect(findings).toEqual([]);
  });

  it("the scan finds a planted leak (negative): a read reply with a correct key, a revealed index too early, and another option's explanation", () => {
    const lesson = lessons[0];
    const clean = { position: 1, prompt: "x", options: ["a", "b"] };
    expect(keyFindings("clean", "read", clean, {}, lessons)).toEqual([]);
    expect(keyFindings("planted", "read", { ...clean, correct: 0 }, {}, lessons).join()).toMatch(/answer-key field/);
    expect(keyFindings("planted", "read", { options: [lesson.questions[0].options[0].why] }, {}, lessons).join()).toMatch(/explanation text/);
    const opts = lesson.questions[0].options;
    const wrongIdx = opts.findIndex((o) => !o.correct), rightIdx = opts.findIndex((o) => o.correct);
    const early = { correct: false, why: opts[wrongIdx].why, wrong_so_far: 1, answered_right: false, correct_option: rightIdx };
    expect(keyFindings("early", "answer", early, {}, lessons, { lesson, q: 1, option: wrongIdx }).join()).toMatch(/too early/);
    const otherWhy = { correct: false, why: opts[wrongIdx].why + " " + opts[rightIdx].why, wrong_so_far: 1, answered_right: false };
    expect(keyFindings("other", "answer", otherWhy, {}, lessons, { lesson, q: 1, option: wrongIdx }).length).toBeGreaterThan(0);
  });

  it("scan exemption is tested: a prompt that holds the word why is not a finding, but a why KEY is", () => {
    const prompts = lessons.flatMap((l) => l.questions.map((q) => q.prompt)).filter((p) => /\bwhy\b/i.test(p));
    expect(prompts.length).toBeGreaterThan(0);
    expect(keyFindings("prompt", "read", { prompt: prompts[0] }, {}, lessons)).toEqual([]);
    expect(keyFindings("key", "read", { why: "x" }, {}, lessons).length).toBeGreaterThan(0);
  });

  it("20 identical answers and 20 'mark read' calls at once over real HTTP: one row each, 20 attempts; 80 answers at once let exactly 60 through", async () => {
    const { token, id } = await register(h, "Ann");
    const key = lessons[2].questions[0].options.findIndex((o) => o.correct);
    const answers = await Promise.all(Array.from({ length: 20 }, () => call(token, "POST", "/lessons/brier-score/questions/1/answer", { option: key })));
    expect(new Set(answers.map((a) => a.body.correct))).toEqual(new Set([true]));
    await Promise.all(Array.from({ length: 20 }, () => call(token, "POST", "/lessons/brier-score/steps/4/read")));
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.quiz_answer WHERE learner_id = $1", [id])).rows[0].n).toBe(20);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.lesson_progress WHERE learner_id = $1", [id])).rows[0].n).toBe(1);
    const more = await Promise.all(Array.from({ length: 80 }, () => call(token, "POST", "/lessons/brier-score/questions/2/answer", { option: 0 })));
    expect(more.filter((r) => r.status === 200)).toHaveLength(40); // 20 used above + 40 more = the limit of 60
    expect(more.filter((r) => r.status === 429)).toHaveLength(40);
    for (const r of more.filter((x) => x.status === 429)) expect(Number(r.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.rate_event WHERE kind = 'lesson-answer'")).rows[0].n).toBe(60);
  });

  it("ISOLATION FUZZ: 200 random attempts by two learners; bad identifiers give identical 404 bodies; progress never crosses", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    let seed = 3;
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); };
    const bad404: string[] = [];
    const mine: Record<string, Set<string>> = { [a.id]: new Set(), [b.id]: new Set() };
    let notFound = 0;
    for (let i = 0; i < 200; i++) {
      const who = rnd(2) ? a : b;
      const kind = rnd(4);
      if (kind === 0) {
        const slug = SLUGS[rnd(7)], n = 1 + rnd(5);
        const r = await call(who.token, "POST", `/lessons/${slug}/steps/${n}/read`);
        expect(r.status).toBe(200);
        mine[who.id].add(`${slug}/${n}`);
      } else {
        const paths = [`/lessons/${["nope", "x%20y", "BRIER", "brier_score"][rnd(4)]}`, `/lessons/brier-score/steps/${["0", "9", "x", "-1"][rnd(4)]}/read`];
        const p = paths[rnd(2)];
        const r = await call(who.token, p.includes("/steps/") ? "POST" : "GET", p);
        if (r.status === 404) {
          notFound++;
          const { request_id, ...rest } = r.body;
          bad404.push(JSON.stringify(rest));
        } else expect([200, 404]).toContain(r.status);
      }
    }
    expect(notFound).toBeGreaterThan(80);
    expect(new Set(bad404)).toEqual(new Set([JSON.stringify({ statusCode: 404, message: "That lesson was not found." })]));
    for (const who of [a, b]) {
      const got = new Set<string>();
      for (const s of SLUGS) for (const n of (await call(who.token, "GET", `/lessons/${s}`)).body.steps_read_list) got.add(`${s}/${n}`);
      expect(got).toEqual(mine[who.id]);
    }
  });

  it("contracts: every lesson route validates, and a renamed field fails (negative)", async () => {
    const { token } = await register(h, "Ann");
    const list = await call(token, "GET", "/lessons");
    for (const x of list.body) expect(validates("LessonSummaryDto", x)).toEqual([]);
    const detail = await call(token, "GET", "/lessons/calibration");
    expect(validates("LessonDetailDto", detail.body)).toEqual([]);
    const renamed = { ...detail.body, title_text: detail.body.title };
    delete renamed.title;
    expect(validates("LessonDetailDto", renamed).length).toBeGreaterThan(0);
    const ans = await call(token, "POST", "/lessons/calibration/questions/1/answer", { option: 0 });
    expect(validates("AnswerResultDto", ans.body)).toEqual([]);
    expect(validates("AnswerResultDto", { ...ans.body, correct: undefined, right: ans.body.correct }).length).toBeGreaterThan(0);
  });

  it("the lesson content hash is stored and unchanged after a second seed (reproducibility)", async () => {
    const before = (await h.pool.query("SELECT slug, content_hash FROM app.lesson ORDER BY position")).rows;
    const r = await seedLessons(h.pool, lessons);
    expect(r).toMatchObject({ inserted: 0, updated: 0, unchanged: 7 });
    expect((await h.pool.query("SELECT slug, content_hash FROM app.lesson ORDER BY position")).rows).toEqual(before);
    expect(before).toHaveLength(7);
  });
});
