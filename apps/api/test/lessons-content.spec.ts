import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { glossarySlugs, lessonsDir, loadValidLessons } from "../scripts/seed-lessons";
import { BANNED, contentHash, DEMO_IDS, LessonFile, markerSlugs, plain, readLessonFiles, setHash, textFields, validateLesson } from "../src/lessons/content";
import { fleschReadingEase } from "../src/common/readability";

const dir = lessonsDir();
const glossary = glossarySlugs();
const good = (): LessonFile => JSON.parse(JSON.stringify(readLessonFiles(dir)[0].lesson));
const problems = (l: unknown, file?: string) => validateLesson(l, dir, glossary, file);

describe("lesson files (the only source of lesson text)", () => {
  const files = readLessonFiles(dir);

  it("there are seven lessons, in positions 1 to 7, and every one validates", () => {
    expect(files).toHaveLength(7);
    expect(files.map((f) => (f.lesson as LessonFile).position).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const f of files) expect(problems(f.lesson, f.file), f.file).toEqual([]);
    expect(loadValidLessons()).toHaveLength(7);
  });

  it("each file name equals its slug, and every question has exactly one correct option", () => {
    for (const f of files) {
      const l = f.lesson as LessonFile;
      expect(f.file).toBe(`${l.slug}.json`);
      for (const q of l.questions) expect(q.options.filter((o) => o.correct)).toHaveLength(1);
    }
  });

  it("reading ease is 60 or more and no sentence is over 25 words (steps, prompts, options, explanations)", () => {
    for (const f of files) for (const t of textFields(f.lesson as LessonFile).filter((x) => x.prose)) {
      expect(fleschReadingEase(plain(t.text)), `${f.file} ${t.where}`).toBeGreaterThanOrEqual(60);
    }
  });

  it("every marker resolves to a glossary term and no banned word appears", () => {
    for (const f of files) for (const t of textFields(f.lesson as LessonFile)) {
      for (const s of markerSlugs(t.text)) expect(glossary.has(s), `${f.file} ${t.where}: ${s}`).toBe(true);
      for (const b of BANNED) expect(new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(plain(t.text).toLowerCase()), `${f.file} ${t.where}: ${b}`).toBe(false);
    }
  });

  it("only known demos are used, and each demo is used by at least one lesson", () => {
    const used = new Set<string>();
    for (const f of files) for (const s of (f.lesson as LessonFile).steps) if (s.demo) used.add(s.demo);
    expect([...used].sort()).toEqual([...DEMO_IDS].sort());
  });

  it("the lessons never use competition words (rank, points, leaderboard; basis points is a unit and is allowed), and give no advice", () => {
    const blocked = /\b(rank|ranks|ranked|(?<!basis )points|leaderboard|level up|you should buy|you should sell)\b/i;
    for (const f of files) for (const t of textFields(f.lesson as LessonFile)) expect(blocked.test(plain(t.text)), `${f.file} ${t.where}`).toBe(false);
  });

  it("the content hash is stable and changes when one word changes", () => {
    const l = good();
    expect(contentHash(l)).toBe(contentHash(JSON.parse(JSON.stringify(l))));
    const changed = good();
    changed.steps[0].body += " ";
    expect(contentHash(changed)).not.toBe(contentHash(l));
    const all = files.map((f) => f.lesson as LessonFile);
    expect(setHash(all)).toBe(setHash([...all].reverse()));
  });
});

describe("the validator rejects bad lessons (negative tests)", () => {
  it("a question with two correct options", () => {
    const l = good(); l.questions[0].options[1].correct = true;
    expect(problems(l).join("\n")).toMatch(/question 1 has 2 correct/);
  });
  it("a question with no correct option", () => {
    const l = good(); l.questions[0].options.forEach((o) => (o.correct = false));
    expect(problems(l).join("\n")).toMatch(/question 1 has 0 correct/);
  });
  it("only two steps", () => {
    const l = good(); l.steps = l.steps.slice(0, 2);
    expect(problems(l).join("\n")).toMatch(/schema/);
  });
  it("an unknown demo id", () => {
    const l = good(); (l.steps[0] as any).demo = "stock-picker";
    expect(problems(l).join("\n")).toMatch(/schema/);
  });
  it("two questions instead of three, and an extra field", () => {
    const l = good(); l.questions = l.questions.slice(0, 2);
    expect(problems(l).join("\n")).toMatch(/schema/);
    const m = good(); (m as any).secret = "x";
    expect(problems(m).join("\n")).toMatch(/schema/);
  });
  it("jargon fails the reading-ease check", () => {
    const l = good();
    l.steps[0].body = "Heteroskedastic autocorrelation notwithstanding, probabilistic reparameterization necessitates comprehensive epistemological consideration.";
    expect(problems(l).join("\n")).toMatch(/reading ease/);
  });
  it("a sentence over 25 words fails", () => {
    const l = good();
    l.steps[0].body = "The price went up and then it went down and then it went up again and then it went down once more until we could not say any more about it at all today.";
    expect(problems(l).join("\n")).toMatch(/sentence has \d+ words/);
  });
  it("a marker that does not resolve fails, and so does a renamed glossary term", () => {
    const l = good(); l.steps[0].body = "A {{no-such-term|thing}} is here, and it is easy to read.";
    expect(problems(l).join("\n")).toMatch(/not a glossary term/);
    const renamed = new Set([...glossary].map((s) => (s === "candle" ? "candle-renamed" : s)));
    const withCandle = readLessonFiles(dir).find((f) => JSON.stringify(f.lesson).includes("{{candle|"))!;
    expect(validateLesson(withCandle.lesson, dir, renamed).join("\n")).toMatch(/marker "candle"/);
  });
  it("a banned word fails", () => {
    const l = good(); l.steps[0].body = "This rule is a guarantee of winning. It is easy to read.";
    expect(problems(l).join("\n")).toMatch(/banned word/);
  });
  it("a file whose name differs from its slug fails", () => {
    expect(problems(good(), "other-name.json").join("\n")).toMatch(/does not match slug/);
  });
  it("the schema file is a real file next to the lessons", () => {
    expect(fs.existsSync(path.join(dir, "lesson.schema.json"))).toBe(true);
  });
});
