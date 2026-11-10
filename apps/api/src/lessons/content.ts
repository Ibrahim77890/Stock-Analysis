import Ajv from "ajv";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fleschReadingEase, longestSentenceWords } from "../common/readability";

export const DEMO_IDS = ["chance-70", "coin-streaks", "many-tries"] as const;
export const BANNED = ["beats the market", "edge", "profit", "alpha", "guarantee", "winning", "proof"];
export const MIN_EASE = 60;
export const MAX_SENTENCE_WORDS = 25;

export interface LessonOption { text: string; why: string; correct: boolean }
export interface LessonQuestion { prompt: string; options: LessonOption[] }
export interface LessonStep { head: string; body: string; more?: string; demo?: string }
export interface LessonFile {
  slug: string; position: number; version: number; title: string; summary: string; minutes: number;
  steps: LessonStep[]; questions: LessonQuestion[];
}

const MARKER = /\{\{([a-z0-9-]+)\|([^}]+)\}\}/g;

/** The words a reader sees (markers replaced by their label). */
export function plain(text: string): string {
  return text.replace(MARKER, "$2");
}

export function markerSlugs(text: string): string[] {
  return [...text.matchAll(MARKER)].map((m) => m[1]);
}

/** Every text field of a lesson with a name for error messages. */
export function textFields(l: LessonFile): Array<{ where: string; text: string; prose: boolean }> {
  const out: Array<{ where: string; text: string; prose: boolean }> = [
    { where: "title", text: l.title, prose: false },
    { where: "summary", text: l.summary, prose: true },
  ];
  l.steps.forEach((s, i) => {
    out.push({ where: `step ${i + 1} head`, text: s.head, prose: false });
    out.push({ where: `step ${i + 1} body`, text: s.body, prose: true });
    if (s.more) out.push({ where: `step ${i + 1} more`, text: s.more, prose: true });
  });
  l.questions.forEach((q, i) => {
    out.push({ where: `question ${i + 1} prompt`, text: q.prompt, prose: true });
    q.options.forEach((o, j) => {
      out.push({ where: `question ${i + 1} option ${j + 1}`, text: o.text, prose: false });
      out.push({ where: `question ${i + 1} option ${j + 1} why`, text: o.why, prose: true });
    });
  });
  return out;
}

let validator: ((x: unknown) => boolean) & { errors?: any[] | null } | undefined;
export function schemaPath(dir: string): string {
  return path.join(dir, "lesson.schema.json");
}

function schemaValidator(dir: string) {
  if (!validator) {
    const ajv = new Ajv({ allErrors: true, strict: true });
    validator = ajv.compile(JSON.parse(fs.readFileSync(schemaPath(dir), "utf8"))) as any;
  }
  return validator!;
}

/**
 * Every problem found in one lesson, in plain words. An empty list means the lesson passes.
 * `glossary` is the set of term slugs a marker may point to.
 */
export function validateLesson(raw: unknown, dir: string, glossary: ReadonlySet<string>, fileName?: string): string[] {
  const problems: string[] = [];
  const v = schemaValidator(dir);
  if (!v(raw)) {
    for (const e of v.errors ?? []) problems.push(`schema: ${e.instancePath || "/"} ${e.message}`);
    return problems;
  }
  const l = raw as LessonFile;
  if (fileName !== undefined && fileName !== `${l.slug}.json`) problems.push(`file name ${fileName} does not match slug ${l.slug}`);
  l.questions.forEach((q, i) => {
    const n = q.options.filter((o) => o.correct).length;
    if (n !== 1) problems.push(`question ${i + 1} has ${n} correct options (needs exactly 1)`);
  });
  for (const f of textFields(l)) {
    for (const slug of markerSlugs(f.text)) {
      if (!glossary.has(slug)) problems.push(`${f.where}: marker "${slug}" is not a glossary term`);
    }
    const shown = plain(f.text);
    const lower = shown.toLowerCase();
    for (const b of BANNED) {
      if (new RegExp(`(^|[^a-z])${b}([^a-z]|$)`).test(lower)) problems.push(`${f.where}: banned word "${b}"`);
    }
    if (f.prose) {
      const ease = fleschReadingEase(shown);
      if (ease < MIN_EASE) problems.push(`${f.where}: reading ease ${ease.toFixed(1)} is below ${MIN_EASE}`);
      const longest = longestSentenceWords(shown);
      if (longest > MAX_SENTENCE_WORDS) problems.push(`${f.where}: a sentence has ${longest} words (limit ${MAX_SENTENCE_WORDS})`);
    }
  }
  return problems;
}

export function readLessonFiles(dir: string): Array<{ file: string; lesson: unknown }> {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && f !== "lesson.schema.json")
    .sort()
    .map((file) => ({ file, lesson: JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) }));
}

/** Stable hash of a lesson's content (key order does not matter). */
export function contentHash(l: LessonFile): string {
  const canon = (x: any): any => (Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])])) : x);
  return createHash("sha256").update(JSON.stringify(canon(l))).digest("hex");
}

/** Hash of all lessons together, in position order (stored as the reproducibility fingerprint). */
export function setHash(lessons: LessonFile[]): string {
  const parts = [...lessons].sort((a, b) => a.position - b.position).map((l) => `${l.slug}:${contentHash(l)}`);
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}
