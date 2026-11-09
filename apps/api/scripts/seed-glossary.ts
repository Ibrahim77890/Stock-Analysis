import * as fs from "node:fs";
import * as path from "node:path";
import { Pool } from "pg";
import { loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";

export interface Term {
  slug: string;
  term: string;
  plain_definition: string;
  example: string | null;
  level: string;
  category: string;
  related: string[];
  source: string;
}

export function slugify(term: string): string {
  return term.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Rows of docs/02-domain/glossary.md: | # | term | definition | example | level | type | related | source | */
export function parseGlossary(markdown: string): Term[] {
  const out: Term[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\|\s*\d+\s*\|/.test(line)) continue;
    const cells = line.replace(/^\||\|\s*$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 8) continue;
    const [, term, definition, example, level, , related, source] = cells;
    out.push({
      slug: slugify(term), term, plain_definition: definition, example: example || null, level: level || "beginner",
      category: "general", related: related ? related.split(",").map((r) => slugify(r)).filter(Boolean) : [], source: source || "project definition",
    });
  }
  return out;
}

export function loadLearningTerms(file: string): Term[] {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Array<Partial<Term>>;
  return raw.map((t) => ({
    slug: t.slug!, term: t.term!, plain_definition: t.plain_definition!, example: t.example ?? null, level: "beginner",
    category: "learning", related: t.related ?? [], source: "project definition",
  }));
}

/** Idempotent upsert; learning terms overlay general ones with the same slug. Returns counts. */
export async function seedGlossary(pool: Pool, terms: Term[]): Promise<{ inserted: number; updated: number; unchanged: number }> {
  const bySlug = new Map<string, Term>();
  for (const t of terms) bySlug.set(t.slug, t); // later entries win (learning overlay is last)
  let inserted = 0, updated = 0, unchanged = 0;
  for (const t of bySlug.values()) {
    const r = await pool.query(
      `INSERT INTO app.glossary_term AS g (slug, term, plain_definition, example, level, category, related, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (slug) DO UPDATE SET term = EXCLUDED.term, plain_definition = EXCLUDED.plain_definition, example = EXCLUDED.example,
         level = EXCLUDED.level, category = EXCLUDED.category, related = EXCLUDED.related, source = EXCLUDED.source
       WHERE (g.term, g.plain_definition, g.example, g.level, g.category, g.related, g.source)
             IS DISTINCT FROM (EXCLUDED.term, EXCLUDED.plain_definition, EXCLUDED.example, EXCLUDED.level, EXCLUDED.category, EXCLUDED.related, EXCLUDED.source)
       RETURNING (xmax = 0) AS inserted`,
      [t.slug, t.term, t.plain_definition, t.example, t.level, t.category, t.related, t.source],
    );
    if (r.rowCount === 0) unchanged++;
    else if (r.rows[0].inserted) inserted++;
    else updated++;
  }
  return { inserted, updated, unchanged };
}

export async function main(): Promise<void> {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (add it to .env; see .env.example).");
  const root = repoRoot();
  const general = parseGlossary(fs.readFileSync(path.join(root, "docs/02-domain/glossary.md"), "utf8"));
  const learning = loadLearningTerms(path.join(root, "apps/api/seed/learning-terms.json"));
  const pool = new Pool({ connectionString: url });
  try {
    console.log(await seedGlossary(pool, [...general, ...learning]));
  } finally {
    await pool.end();
  }
}

if (require.main === module) void main();
