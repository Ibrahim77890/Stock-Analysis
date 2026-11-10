import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import { contentHash, LessonFile, readLessonFiles, setHash, validateLesson } from "../src/lessons/content";
import { loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";
import { loadLearningTerms, parseGlossary } from "./seed-glossary";

export function lessonsDir(): string {
  return path.join(repoRoot(), "apps/api/seed/lessons");
}

export function glossarySlugs(): Set<string> {
  const root = repoRoot();
  const general = parseGlossary(fs.readFileSync(path.join(root, "docs/02-domain/glossary.md"), "utf8"));
  const learning = loadLearningTerms(path.join(root, "apps/api/seed/learning-terms.json"));
  return new Set([...general, ...learning].map((t) => t.slug));
}

/** Loads and validates every lesson. Throws one error listing every problem. */
export function loadValidLessons(dir = lessonsDir(), glossary = glossarySlugs()): LessonFile[] {
  const files = readLessonFiles(dir);
  const problems: string[] = [];
  for (const f of files) for (const p of validateLesson(f.lesson, dir, glossary, f.file)) problems.push(`${f.file}: ${p}`);
  const lessons = files.map((f) => f.lesson as LessonFile);
  const positions = lessons.map((l) => l.position);
  if (new Set(positions).size !== positions.length) problems.push("two lessons share a position");
  if (problems.length) throw new Error(`Lesson files are not valid:\n- ${problems.join("\n- ")}`);
  return lessons.sort((a, b) => a.position - b.position);
}

export interface SeedReport { inserted: number; updated: number; unchanged: number; set_hash: string }

/**
 * Idempotent: the same files report "unchanged". A changed lesson must carry a higher version;
 * earlier attempts keep the version they were made against (quiz_answer.lesson_version).
 */
export async function seedLessons(pool: Pool, lessons: LessonFile[]): Promise<SeedReport> {
  let inserted = 0, updated = 0, unchanged = 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const l of lessons) {
      const hash = contentHash(l);
      const cur = await client.query("SELECT version, content_hash FROM app.lesson WHERE slug = $1 FOR UPDATE", [l.slug]);
      if (cur.rowCount && cur.rows[0].content_hash === hash) { unchanged++; continue; }
      if (cur.rowCount && l.version <= cur.rows[0].version) {
        throw new Error(`Lesson "${l.slug}" changed but its version is still ${l.version}. Raise "version" above ${cur.rows[0].version}.`);
      }
      // The position is unique; park a lesson that moves so two lessons can swap places.
      await client.query("UPDATE app.lesson SET position = -position - 1000 WHERE slug <> $1 AND position = $2", [l.slug, l.position]);
      await client.query(
        `INSERT INTO app.lesson (slug, version, title, summary, minutes, position, content, content_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO UPDATE SET version = EXCLUDED.version, title = EXCLUDED.title, summary = EXCLUDED.summary,
           minutes = EXCLUDED.minutes, position = EXCLUDED.position, content = EXCLUDED.content, content_hash = EXCLUDED.content_hash`,
        [l.slug, l.version, l.title, l.summary, l.minutes, l.position, JSON.stringify({ steps: l.steps }), hash],
      );
      await client.query("DELETE FROM app.lesson_question WHERE lesson_slug = $1", [l.slug]);
      for (const [i, q] of l.questions.entries()) {
        await client.query(
          "INSERT INTO app.lesson_question (lesson_slug, position, version, prompt, options) VALUES ($1,$2,$3,$4,$5)",
          [l.slug, i + 1, l.version, q.prompt, JSON.stringify(q.options)],
        );
      }
      if (cur.rowCount) updated++; else inserted++;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
  return { inserted, updated, unchanged, set_hash: setHash(lessons) };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  loadEnvFile();
  const lessons = loadValidLessons();
  if (argv.includes("--validate-only")) {
    console.log(`valid: ${lessons.length} lessons, set hash ${setHash(lessons)}`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (add it to .env; see .env.example).");
  const pool = new Pool({ connectionString: url });
  try {
    const r = await seedLessons(pool, lessons);
    console.log(r.inserted + r.updated === 0 ? "unchanged" : "seeded", r);
  } finally {
    await pool.end();
  }
}

if (require.main === module) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
