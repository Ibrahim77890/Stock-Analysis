import Ajv from "ajv";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { describe, expect, it, vi, afterAll, beforeAll, beforeEach } from "vitest";
import { fleschReadingEase, longestSentenceWords, words } from "../src/common/readability";
import { repoRoot } from "../src/config/paths";
import { generateDocument, sortKeys, CONTRACT_PATH } from "../scripts/export-openapi";
import { loadLearningTerms, parseGlossary, seedGlossary, slugify } from "../scripts/seed-glossary";
import { auth, HAS_DB, Harness, register, resetAppTables, startApp } from "./helpers";

describe("health and CORS (no database needed for the answers)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.close(); });

  it("health answers 200 and says which part is down", async () => {
    h.fake.health = async () => false;
    const r = await h.http().get("/health");
    expect(r.status).toBe(200);
    expect(r.body.gateway).toBe("ok");
    expect(r.body.python).toBe("down");
    h.fake.health = async () => true;
    expect((await h.http().get("/health")).body.python).toBe("ok");
  });

  it("an allowed origin gets its own origin back; a foreign one gets nothing; preflight works", async () => {
    const ok = await h.http().get("/health").set("Origin", "http://127.0.0.1:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    const bad = await h.http().get("/health").set("Origin", "https://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const pre = await h.http().options("/episodes").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "content-type,authorization");
    expect(pre.status).toBeLessThan(300);
    expect(pre.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(pre.headers["access-control-allow-origin"]).not.toBe("*");
  });

  it("errors never contain internal details", async () => {
    const r = await h.http().get("/episodes/xyz");
    expect(r.status).toBe(401);
    expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|127\.0\.0\.1/);
    expect(r.headers["x-request-id"]).toBeTruthy();
  });
});

describe("OpenAPI contract", () => {
  it("the committed file equals the generated document; a renamed field is detected", async () => {
    const doc = sortKeys(await generateDocument());
    expect(fs.existsSync(CONTRACT_PATH), "run: npm run export:openapi").toBe(true);
    expect(JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"))).toEqual(doc);
    const changed = JSON.parse(JSON.stringify(doc));
    changed.components.schemas.PredictionDto.properties.probability_up = changed.components.schemas.PredictionDto.properties.p_up;
    delete changed.components.schemas.PredictionDto.properties.p_up;
    expect(changed).not.toEqual(doc);
  });

  it("the generated Python types are current", () => {
    const root = repoRoot();
    const cwd = path.join(root, "apps", "api");
    const tmp = path.join(cwd, "dist", "schema.check.d.ts");
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    const r = spawnSync(process.execPath, [path.join(cwd, "node_modules/openapi-typescript/bin/cli.js"), path.join(root, "docs/02-domain/openapi-market-data.json"), "-o", tmp], { cwd, encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(tmp, "utf8")).toEqual(fs.readFileSync(path.join(cwd, "src/python/schema.d.ts"), "utf8"));
  });
});

describe("learning terms", () => {
  const terms = loadLearningTerms(path.join(repoRoot(), "apps/api/seed/learning-terms.json"));

  it("every definition is short and easy to read", () => {
    const hard: string[] = [];
    for (const t of terms) {
      const n = words(t.plain_definition).length;
      const fre = fleschReadingEase(t.plain_definition);
      if (n > 40 || fre < 60 || longestSentenceWords(t.plain_definition) > 25) hard.push(`${t.slug}: ${n} words, reading ease ${fre.toFixed(0)}`);
    }
    expect(hard).toEqual([]);
  });

  it("a jargon-heavy sample fails the same check (negative)", () => {
    const jargon = "Calibration quantifies the correspondence between ex-ante probabilistic assertions and subsequently realised frequencies.";
    expect(fleschReadingEase(jargon)).toBeLessThan(60);
  });

  it("covers every word the screens use", () => {
    const needed = ["close", "open", "high-and-low", "candle", "day", "horizon", "probability", "guess", "brier-score", "coin-flip", "calibration", "base-rate", "luck", "blind-episode", "reveal", "made-up-series", "sample-size", "overconfidence", "hindsight-bias", "data-trail"];
    expect(terms.map((t) => t.slug)).toEqual(expect.arrayContaining(needed));
  });

  it("the markdown glossary parses and slugs are stable", () => {
    const general = parseGlossary(fs.readFileSync(path.join(repoRoot(), "docs/02-domain/glossary.md"), "utf8"));
    expect(general.length).toBeGreaterThan(60);
    expect(slugify("Brier score")).toBe("brier-score");
  });
});

describe.skipIf(!HAS_DB)("glossary (database)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await h.pool.query("TRUNCATE app.glossary_term"); });

  it("seed is idempotent; search and lookup work without signing in", async () => {
    const root = repoRoot();
    const all = [...parseGlossary(fs.readFileSync(path.join(root, "docs/02-domain/glossary.md"), "utf8")), ...loadLearningTerms(path.join(root, "apps/api/seed/learning-terms.json"))];
    const first = await seedGlossary(h.pool, all);
    const second = await seedGlossary(h.pool, all);
    expect(first.inserted).toBeGreaterThan(80);
    expect(second).toEqual({ inserted: 0, updated: 0, unchanged: first.inserted + first.updated + first.unchanged });
    const found = await h.http().get("/glossary?q=brier");
    expect(found.status).toBe(200);
    expect(found.body.some((t: any) => t.slug === "brier-score")).toBe(true);
    const one = await h.http().get("/glossary/brier-score");
    expect(one.body.category).toBe("learning");
    expect(one.body.plain_definition).toMatch(/0\.25/);
    expect((await h.http().get("/glossary/not-a-word")).status).toBe(404);
    expect((await h.http().get("/glossary?category=learning")).body.length).toBeGreaterThanOrEqual(20);
  });
});
