import Ajv from "ajv";
import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/bootstrap";
import { loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";
import { auth, HAS_DB, Harness, makeCfg, register, resetAppTables, SECRETS, TEST_URL } from "./helpers";

loadEnvFile();
const REAL_URL = process.env.DATABASE_URL;
const ROOT = repoRoot();
const PY = path.join(ROOT, "services", "market-data", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const CAN_RUN = HAS_DB && Boolean(REAL_URL) && fs.existsSync(PY);
const SYMBOLS = ["AAPL", "MSFT", "KO"];
const free = (): Promise<number> => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

async function seedTiingo(real: Pool, test: Pool, symbols: string[]): Promise<void> {
  await test.query("TRUNCATE market.bar_daily, market.corporate_action, market.ingestion_job, market.instrument RESTART IDENTITY CASCADE");
  await test.query("TRUNCATE research.lab_study, research.trial, research.study, research.paper_decision, research.prediction, research.episode RESTART IDENTITY CASCADE");
  const job = await test.query("INSERT INTO market.ingestion_job (kind, source, file_name, file_sha256, status) VALUES ('bars','tiingo','x','x','succeeded') RETURNING ingestion_job_id");
  for (const sym of symbols) {
    const inst = await test.query("INSERT INTO market.instrument (symbol, name, asset_type) VALUES ($1,$2,'stock') RETURNING instrument_id", [sym, sym]);
    const bars = await real.query("SELECT trade_date::text d, open::float8 o, high::float8 h, low::float8 l, close::float8 c, volume v FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE i.symbol=$1 AND b.source='tiingo' ORDER BY 1", [sym]);
    await test.query(
      "INSERT INTO market.bar_daily (instrument_id, trade_date, source, open, high, low, close, volume, ingestion_job_id) SELECT $1, d, 'tiingo', o, h, l, c, v, $2 FROM unnest($3::date[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::bigint[]) AS t(d,o,h,l,c,v)",
      [inst.rows[0].instrument_id, job.rows[0].ingestion_job_id, bars.rows.map((r) => r.d), bars.rows.map((r) => r.o), bars.rows.map((r) => r.h), bars.rows.map((r) => r.l), bars.rows.map((r) => r.c), bars.rows.map((r) => r.v)],
    );
    const acts = await real.query("SELECT action_type, ex_date::text d, split_from::float8 f, split_to::float8 t, cash_amount::float8 c FROM market.corporate_action a JOIN market.instrument i USING (instrument_id) WHERE i.symbol=$1 AND a.source='tiingo'", [sym]);
    for (const a of acts.rows) {
      await test.query("INSERT INTO market.corporate_action (instrument_id, action_type, ex_date, split_from, split_to, cash_amount, source, ingestion_job_id) VALUES ($1,$2,$3,$4,$5,$6,'tiingo',$7)", [inst.rows[0].instrument_id, a.action_type, a.d, a.f, a.t, a.c, job.rows[0].ingestion_job_id]);
    }
  }
}

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
  const v = ajv.getSchema(`doc#/components/schemas/${schema}`)!;
  return v(body) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

/** A reply of an OPEN mixed episode: no symbol, no date, no kind, and no value for a day beyond the revealed day. */
export function openEpisodeFindings(label: string, body: any, headers: Record<string, string>, day: number): string[] {
  const out: string[] = [];
  const text = JSON.stringify(body) + JSON.stringify(headers);
  if (/"symbol"|"start_date"|"kind"|"first_date"|"last_date"|"client_key"/.test(text)) out.push(`${label}: identity or key field`);
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(JSON.stringify(body))) out.push(`${label}: a date`);
  for (const sym of SYMBOLS) if (new RegExp(`\\b${sym}\\b`).test(text)) out.push(`${label}: symbol ${sym}`);
  for (const v of body?.values ?? []) if (v.day > day) out.push(`${label}: value for day ${v.day} beyond day ${day}`);
  return out;
}

describe.skipIf(!CAN_RUN)("indicators and decisions on the real stack (real Python, real Tiingo data copied to the test database)", () => {
  let py: ChildProcess;
  let h: Harness;
  let real: Pool;
  let test: Pool;
  let base = "";

  const call = async (token: string, method: "GET" | "POST", p: string, body?: object) => {
    const res = await fetch(base + p, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : method === "POST" ? "{}" : undefined });
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => (headers[k] = v));
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json, headers };
  };

  beforeAll(async () => {
    real = new Pool({ connectionString: REAL_URL, max: 1 });
    test = new Pool({ connectionString: TEST_URL, max: 2 });
    await seedTiingo(real, test, SYMBOLS);
    const port = await free();
    const pyBase = `http://127.0.0.1:${port}`;
    py = spawn(PY, ["-m", "market_data.cli", "serve", "--port", String(port)], {
      cwd: path.join(ROOT, "services", "market-data"), env: { ...process.env, DATABASE_URL: TEST_URL!, INTERNAL_API_TOKEN: SECRETS.internal }, stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(pyBase + "/health")).ok) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    const cfg = makeCfg({ pythonApiUrl: pyBase });
    const app = await buildApp(cfg);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    const pool = new Pool({ connectionString: TEST_URL, max: 2 });
    await resetAppTables(pool);
    h = { app, fake: {} as any, cfg, pool, http: () => request(base), close: async () => { await pool.end(); await app.close(); } };
  }, 180_000);

  afterAll(async () => { await h?.close(); py?.kill(); await real?.end(); await test?.end(); });

  it("LEAK FUZZ: real and made-up mixed episodes, random advances, indicators and decisions read at every step: nothing beyond the revealed day, no identity; contracts validate; a planted leak is detected", async () => {
    const { token } = await register(h, "Leak1");
    let seed = 19;
    const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return Math.floor((seed / 4294967296) * n); };
    const findings: string[] = [];
    let scanned = 0, keyNo = 0;
    for (let e = 0; e < 6; e++) {
      await h.pool.query("DELETE FROM app.rate_event"); // 36 decisions in this loop would pass the limit of 30 a minute
      const made = await call(token, "POST", "/episodes", { kind: "mixed", n_bars: 120, initial_visible: 60, seed: 100 + e });
      expect(made.status).toBe(200);
      const id = made.body.episode_id;
      let day = made.body.day;
      for (let step = 0; step < 6; step++) {
        for (const name of ["sma", "ema", "rsi"]) {
          const r = await call(token, "GET", `/episodes/${id}/indicators?name=${name}&window=${name === "rsi" ? 14 : 20}`);
          expect(r.status).toBe(200);
          expect(validates("IndicatorDto", r.body)).toEqual([]);
          findings.push(...openEpisodeFindings(`${id} ${name}@${day}`, r.body, r.headers, day));
          scanned++;
        }
        const d = await call(token, "POST", `/episodes/${id}/decisions`, { stance: rnd(2) ? "long" : "flat", reason: "Neutral note.", client_key: `fuzz-key-${++keyNo}-abcdef`, cost_bps: 2 });
        expect(d.status).toBe(200);
        expect(validates("DecisionDto", d.body)).toEqual([]);
        findings.push(...openEpisodeFindings(`${id} decision@${day}`, d.body, d.headers, day));
        const j = await call(token, "GET", `/episodes/${id}/decisions`);
        expect(validates("JournalDto", j.body)).toEqual([]);
        findings.push(...openEpisodeFindings(`${id} journal@${day}`, j.body, j.headers, day));
        scanned += 2;
        const adv = await call(token, "POST", `/episodes/${id}/advance`, { n: 1 + rnd(4) });
        day = adv.body.day;
      }
    }
    expect(scanned).toBeGreaterThan(150);
    expect(findings).toEqual([]);
    // the scan really finds leaks (negative)
    expect(openEpisodeFindings("p", { values: [{ day: 90, value: 1 }] }, {}, 60).join()).toMatch(/beyond/);
    expect(openEpisodeFindings("p", { symbol: "AAPL" }, {}, 60).length).toBeGreaterThan(0);
    expect(openEpisodeFindings("p", { a: "2015-03-02" }, {}, 60).join()).toMatch(/a date/);
  }, 240_000);

  it("CAUSALITY over HTTP: the value of an indicator on day t is the same when read at day t and after the episode has moved on", async () => {
    const { token } = await register(h, "Causal1");
    const id = (await call(token, "POST", "/episodes", { kind: "real", n_bars: 120, initial_visible: 60, seed: 7 })).body.episode_id;
    const early: Record<string, any[]> = {};
    for (const [name, w] of [["sma", 20], ["ema", 20], ["rsi", 14]] as const) early[name] = (await call(token, "GET", `/episodes/${id}/indicators?name=${name}&window=${w}`)).body.values;
    await call(token, "POST", `/episodes/${id}/advance`, { n: 20 });
    await call(token, "POST", `/episodes/${id}/advance`, { n: 20 });
    for (const [name, w] of [["sma", 20], ["ema", 20], ["rsi", 14]] as const) {
      const late = (await call(token, "GET", `/episodes/${id}/indicators?name=${name}&window=${w}`)).body.values;
      expect(late.length).toBe(early[name].length + 40);
      expect(late.slice(0, early[name].length)).toEqual(early[name]); // identical, not merely close
    }
  }, 120_000);

  it("IDEMPOTENCY: 20 identical decisions at once store one row; 40 distinct-day decisions at once let exactly 30 through (limit 30)", async () => {
    const { token, id } = await register(h, "Conc1");
    const ep = (await call(token, "POST", "/episodes", { kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 3 })).body.episode_id;
    const body = { stance: "long", reason: "Same key.", client_key: "same-key-concurrent-1", cost_bps: 2 };
    const same = await Promise.all(Array.from({ length: 20 }, () => call(token, "POST", `/episodes/${ep}/decisions`, body)));
    expect(same.every((r) => r.status === 200)).toBe(true);
    expect(same.filter((r) => r.body.created).length).toBe(1);
    expect((await test.query("SELECT count(*)::int AS n FROM research.paper_decision WHERE episode_id = $1", [ep])).rows[0].n).toBe(1);
    await h.pool.query("DELETE FROM app.rate_event");
    const burst = await Promise.all(Array.from({ length: 40 }, (_, i) => call(token, "POST", `/episodes/${ep}/decisions`, { ...body, client_key: `burst-key-${i}-abcdefgh` })));
    expect(burst.filter((r) => r.status === 429)).toHaveLength(10);
    expect(burst.filter((r) => r.status !== 429).length).toBe(30); // 200s and 422s (one day holds one decision) both used a slot
    expect(burst.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    void id;
  }, 120_000);

  it("RECONCILIATION: results recomputed in the test from the stored rows and the revealed closes equal the API's results and totals", async () => {
    const { token } = await register(h, "Recon1");
    const ep = (await call(token, "POST", "/episodes", { kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 11 })).body.episode_id;
    const stances = ["long", "long", "flat", "long", "flat", "long"];
    for (const [i, s] of stances.entries()) {
      expect((await call(token, "POST", `/episodes/${ep}/decisions`, { stance: s, reason: `r${i}`, client_key: `recon-key-${i}-abcdefgh`, cost_bps: 5 })).status).toBe(200);
      await call(token, "POST", `/episodes/${ep}/advance`, { n: 3 });
    }
    const bars = (await call(token, "GET", `/episodes/${ep}/bars`)).body.bars as Array<{ day: number; close: number }>;
    const journal = (await call(token, "GET", `/episodes/${ep}/decisions`)).body;
    const rows = (await test.query("SELECT day, stance, cost_bps::float8 c FROM research.paper_decision WHERE episode_id = $1 ORDER BY day", [ep])).rows;
    expect(rows).toHaveLength(6);
    let prev = "flat", growth = 1;
    rows.forEach((r, i) => {
      const end = i + 1 < rows.length ? rows[i + 1].day : bars.length;
      let f = r.stance !== prev ? 1 - r.c / 10000 : 1;
      if (r.stance === "long") for (let t = r.day + 1; t <= end; t++) f *= bars[t - 1].close / bars[t - 2].close;
      expect(journal.decisions[i].result).toBeCloseTo(f - 1, 10);
      growth *= f;
      prev = r.stance;
    });
    expect(journal.totals.growth).toBeCloseTo(growth - 1, 10);
    expect(journal.totals.decisions).toBe(6);
  }, 120_000);

  it("ISOLATION FUZZ: 200 cross-access attempts on indicators and decisions are the same 404 and change nothing", async () => {
    const a = await register(h, "IsoA"), b = await register(h, "IsoB");
    const ea = (await call(a.token, "POST", "/episodes", { kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 1 })).body.episode_id;
    const before = (await test.query("SELECT count(*)::int AS n FROM research.paper_decision")).rows[0].n;
    const bodies = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const r = i % 3 === 0 ? await call(b.token, "GET", `/episodes/${ea}/indicators?name=sma`)
        : i % 3 === 1 ? await call(b.token, "GET", `/episodes/${ea}/decisions`)
        : await call(b.token, "POST", `/episodes/${ea}/decisions`, { stance: "long", reason: "x", client_key: `iso-key-${i}-abcdefgh` });
      expect(r.status).toBe(404);
      const { request_id, ...rest } = r.body;
      bodies.add(JSON.stringify(rest));
    }
    expect(bodies).toEqual(new Set([JSON.stringify({ statusCode: 404, message: "That episode was not found." })]));
    expect((await test.query("SELECT count(*)::int AS n FROM research.paper_decision")).rows[0].n).toBe(before);
  }, 120_000);

  it("a renamed field fails the contract (negative) and the append-only trigger refuses UPDATE and DELETE on the real database", async () => {
    const { token } = await register(h, "Contract1");
    const ep = (await call(token, "POST", "/episodes", { kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 2 })).body.episode_id;
    await call(token, "POST", `/episodes/${ep}/decisions`, { stance: "long", reason: "x", client_key: "contract-key-abcdef" });
    const j = (await call(token, "GET", `/episodes/${ep}/decisions`)).body;
    expect(validates("JournalDto", j)).toEqual([]);
    const renamed = { ...j, decisions: j.decisions.map((d: any) => ({ ...d, held: d.stance })) };
    expect(validates("JournalDto", renamed).length).toBeGreaterThan(0);
    await expect(test.query("UPDATE research.paper_decision SET stance = 'flat'")).rejects.toThrow(/append-only/);
    await expect(test.query("DELETE FROM research.paper_decision")).rejects.toThrow(/append-only/);
  }, 60_000);
});
