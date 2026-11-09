import Ajv from "ajv";
import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as net from "node:net";
import * as path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/bootstrap";
import { loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";
import { auth, HAS_DB, Harness, makeCfg, register, resetAppTables, SECRETS, TEST_URL } from "./helpers";
import request from "supertest";

loadEnvFile();
const REAL_URL = process.env.DATABASE_URL;
const ROOT = repoRoot();
const PY = path.join(ROOT, "services", "market-data", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const CAN_RUN = HAS_DB && Boolean(REAL_URL) && fs.existsSync(PY);

const free = (): Promise<number> => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

async function seedTiingoAapl(real: Pool, test: Pool): Promise<void> {
  await test.query("TRUNCATE market.bar_daily, market.corporate_action, market.ingestion_job, market.instrument RESTART IDENTITY CASCADE");
  const inst = await test.query("INSERT INTO market.instrument (symbol, name, asset_type) VALUES ('AAPL','Apple Inc.','stock') RETURNING instrument_id");
  const job = await test.query("INSERT INTO market.ingestion_job (kind, source, file_name, file_sha256, status) VALUES ('bars','tiingo','x','x','succeeded') RETURNING ingestion_job_id");
  const bars = await real.query("SELECT trade_date::text d, open::float8 o, high::float8 h, low::float8 l, close::float8 c, volume v FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE i.symbol='AAPL' AND b.source='tiingo' AND trade_date <= '2021-12-31' ORDER BY 1");
  await test.query(
    "INSERT INTO market.bar_daily (instrument_id, trade_date, source, open, high, low, close, volume, ingestion_job_id) SELECT $1, d, 'tiingo', o, h, l, c, v, $2 FROM unnest($3::date[], $4::float8[], $5::float8[], $6::float8[], $7::float8[], $8::bigint[]) AS t(d,o,h,l,c,v)",
    [inst.rows[0].instrument_id, job.rows[0].ingestion_job_id, bars.rows.map((r) => r.d), bars.rows.map((r) => r.o), bars.rows.map((r) => r.h), bars.rows.map((r) => r.l), bars.rows.map((r) => r.c), bars.rows.map((r) => r.v)],
  );
  const acts = await real.query("SELECT action_type, ex_date::text d, split_from::float8 f, split_to::float8 t, cash_amount::float8 c FROM market.corporate_action a JOIN market.instrument i USING (instrument_id) WHERE i.symbol='AAPL' AND a.source='tiingo' AND ex_date <= '2021-12-31'");
  for (const a of acts.rows) {
    await test.query("INSERT INTO market.corporate_action (instrument_id, action_type, ex_date, split_from, split_to, cash_amount, source, ingestion_job_id) VALUES ($1,$2,$3,$4,$5,$6,'tiingo',$7)", [inst.rows[0].instrument_id, a.action_type, a.d, a.f, a.t, a.c, job.rows[0].ingestion_job_id]);
  }
}

// ---- JSON-schema validation of responses against the committed OpenAPI contract (extra fields are errors)
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
const contract = strict(JSON.parse(fs.readFileSync(path.join(ROOT, "docs/02-domain/openapi-gateway.json"), "utf8")));
const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(contract, "doc");
export function validates(schema: string, body: unknown): string[] {
  const v = ajv.getSchema(`doc#/components/schemas/${schema}`);
  if (!v) throw new Error(`no schema ${schema}`);
  return v(body) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
}

const YEAR = /\b(200[5-9]|201\d|202[0-5])\b/;
const ISO = /\d{4}-\d{2}-\d{2}/;
// `created_at` (when the learner started an episode) and `time` (when they made a request) come from the learner's own clock, not from market data: the only exempt keys
function strings(o: any): string[] { return typeof o === "string" ? [o] : Array.isArray(o) ? o.flatMap(strings) : o && typeof o === "object" ? Object.entries(o).filter(([k]) => k !== "created_at" && k !== "time").flatMap(([k, v]) => [k, ...strings(v)]) : []; }
function identity(obj: unknown): string[] {
  return strings(obj).filter((s) => /AAPL|Apple|tiingo|"?symbol"?|start_date|factor|as_of/i.test(s) || YEAR.test(s) || ISO.test(s));
}

describe.skipIf(!CAN_RUN)("end to end: real gateway + real Python service + database", () => {
  let py: ChildProcess;
  let h: Harness;
  let real: Pool;
  const pyLog: string[] = [];
  let pyBase = "";
  let tick = 0;

  beforeAll(async () => {
    real = new Pool({ connectionString: REAL_URL, max: 1 });
    const test = new Pool({ connectionString: TEST_URL, max: 1 });
    await seedTiingoAapl(real, test);
    await test.end();
    const port = await free();
    pyBase = `http://127.0.0.1:${port}`;
    py = spawn(PY, ["-m", "market_data.cli", "serve", "--port", String(port)], {
      cwd: path.join(ROOT, "services", "market-data"), env: { ...process.env, DATABASE_URL: TEST_URL!, INTERNAL_API_TOKEN: SECRETS.internal }, stdio: ["ignore", "pipe", "pipe"],
    });
    py.stdout?.on("data", (d) => pyLog.push(String(d)));
    py.stderr?.on("data", (d) => pyLog.push(String(d)));
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(pyBase + "/health")).ok) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    const cfg = makeCfg({ pythonApiUrl: pyBase });
    const app = await buildApp(cfg);
    await app.init();
    const pool = new Pool({ connectionString: TEST_URL, max: 2 });
    await resetAppTables(pool);
    h = { app, fake: {} as any, cfg, pool, http: () => request(app.getHttpServer()), close: async () => { await pool.end(); await app.close(); } };
  }, 120_000);

  afterAll(async () => { await h?.close(); py?.kill(); await real?.end(); });

  const create = (t: string, body: object) => h.http().post("/episodes").set(auth(t)).send(body);

  it("Python learning endpoints refuse calls without the internal token (so the gateway is the only way in)", async () => {
    expect((await fetch(pyBase + "/episodes", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await fetch(pyBase + "/learning/summary")).status).toBe(401);
    const ok = await fetch(pyBase + "/episodes", { method: "POST", headers: { "content-type": "application/json", "x-internal-token": SECRETS.internal }, body: JSON.stringify({ kind: "synthetic", seed: 1 }) });
    expect(ok.status).toBe(200);
  });

  it("the whole loop validates against the OpenAPI contract, and an extra identity field would fail validation", async () => {
    const { token } = await register(h, "Ann");
    const e = await create(token, { kind: "real", n_bars: 120, seed: 5 });
    expect(e.status).toBe(200);
    expect(validates("EpisodeStateDto", e.body)).toEqual([]);
    const id = e.body.episode_id;
    expect(validates("BarsDto", (await h.http().get(`/episodes/${id}/bars`).set(auth(token))).body)).toEqual([]);
    const g = await h.http().post(`/episodes/${id}/predictions`).set(auth(token)).send({ horizon: 5, p_up: 0.7 });
    expect(validates("PredictionItemDto", g.body)).toEqual([]);
    const adv = await h.http().post(`/episodes/${id}/advance`).set(auth(token)).send({ n: 5 });
    expect(validates("EpisodeStateDto", adv.body)).toEqual([]);
    expect(validates("PredictionsDto", (await h.http().get(`/episodes/${id}/predictions`).set(auth(token))).body)).toEqual([]);
    const sc = await h.http().get(`/episodes/${id}/score`).set(auth(token));
    expect(validates("ScoreDto", sc.body)).toEqual([]);
    const rev = await h.http().post(`/episodes/${id}/reveal`).set(auth(token));
    expect(validates("RevealDto", rev.body)).toEqual([]);
    expect(rev.body.identity.symbol).toBe("AAPL");
    expect(validates("ProgressDto", (await h.http().get("/me/progress").set(auth(token))).body)).toEqual([]);
    expect(validates("TraceEntryDto", (await h.http().get("/trace").set(auth(token))).body[0])).toEqual([]);
    expect(validates("SystemDto", (await h.http().get("/system").set(auth(token))).body)).toEqual([]);
    // negative: an undeclared identity field fails
    expect(validates("EpisodeStateDto", { ...e.body, symbol: "AAPL" }).length).toBeGreaterThan(0);
    expect(validates("BarsDto", { ...(await h.http().get(`/episodes/${id}/bars`).set(auth(token))).body, bars: [{ day: 1, open: 1, high: 1, low: 1, close: 1, rel_volume: 1, date: "2015-03-02" }] }).length).toBeGreaterThan(0);
  });

  it("identity-leak fuzz: 100 episodes, every non-reveal response, error body and header, plus the OpenAPI examples", async () => {
    const { token } = await register(h, "Leak");
    let seed = 11;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const findings: string[] = [];
    const check = (label: string, r: any) => {
      const bad = identity(r.body);
      if (bad.length) findings.push(`${label} body: ${bad[0]}`);
      for (const [k, v] of Object.entries(r.headers)) if (identity({ [k]: String(v) }).length && !/date|x-powered|etag|content-type/i.test(k)) findings.push(`${label} header ${k}`);
    };
    const COUNT = Number(process.env.LEAK_EPISODES ?? 100);
    for (let i = 0; i < COUNT; i++) {
      const kind = ["real", "synthetic", "mixed"][i % 3];
      const e = await create(token, { kind, n_bars: [80, 120, 250][rnd(3)], seed: i });
      check("create", e);
      const id = e.body.episode_id;
      check("guess", await h.http().post(`/episodes/${id}/predictions`).set(auth(token)).send({ horizon: [1, 5, 10][rnd(3)], p_up: (1 + rnd(98)) / 100 }));
      for (let k = 0; k < 1 + rnd(2); k++) check("advance", await h.http().post(`/episodes/${id}/advance`).set(auth(token)).send({ n: 1 + rnd(8) }));
      for (const p of ["", "/bars", "/predictions", "/score"]) check(`get${p}`, await h.http().get(`/episodes/${id}${p}`).set(auth(token)));
      check("list", await h.http().get("/episodes").set(auth(token)));
      check("422", await h.http().post(`/episodes/${id}/advance`).set(auth(token)).send({ n: 99 }));
      check("404", await h.http().get("/episodes/zzzzzzzz/bars").set(auth(token)));
    }
    check("401", await h.http().get("/episodes/abc"));
    check("progress", await h.http().get("/me/progress").set(auth(token)));
    check("trace", await h.http().get("/trace").set(auth(token)));
    const spec = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/02-domain/openapi-gateway.json"), "utf8"));
    const exampleStrings = strings(spec.paths).filter((s) => /AAPL|Apple/i.test(s));
    expect(exampleStrings).toEqual([]);
    expect(findings.slice(0, 6)).toEqual([]);
  }, 900_000);

  it("a deliberately leaky reply is caught by the scan (negative test)", () => {
    expect(identity({ bars: [{ day: 1 }], symbol: "AAPL" }).length).toBeGreaterThan(0);
    expect(identity({ day: 60, note: "from 2015-03-02" }).length).toBeGreaterThan(0);
    expect(identity({ day: 60, close: 100.2013 })).toEqual([]);        // numbers are not scanned for years
  });

  it("learner isolation fuzz: 300 attempts across 3 learners, zero cross-access, zero Python calls for refused requests", async () => {
    const people = [await register(h, "P1"), await register(h, "P2"), await register(h, "P3")];
    const owned: string[] = [];
    for (const p of people) owned.push((await create(p.token, { kind: "synthetic", seed: tick++ })).body.episode_id);
    const real = globalThis.fetch;
    let pythonCalls = 0;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(((u: any, i: any) => { if (String(u).startsWith(pyBase)) pythonCalls++; return real(u, i); }) as any);
    const routes: Array<[string, (id: string) => string, object?]> = [
      ["get", (id) => `/episodes/${id}`], ["get", (id) => `/episodes/${id}/bars`], ["post", (id) => `/episodes/${id}/advance`, { n: 1 }],
      ["post", (id) => `/episodes/${id}/predictions`, { horizon: 1, p_up: 0.5 }], ["get", (id) => `/episodes/${id}/predictions`], ["get", (id) => `/episodes/${id}/score`], ["post", (id) => `/episodes/${id}/reveal`],
    ];
    let seed = 3;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    let owners200 = 0;
    for (let i = 0; i < 300; i++) {
      const attacker = rnd(3), victim = (attacker + 1 + rnd(2)) % 3;
      const [m, p, body] = routes[rnd(routes.length)];
      if (m === "post" && p("x").endsWith("reveal")) continue; // never reveal a victim's episode in the fuzz
      const r = await ((h.http() as any)[m](p(owned[victim])).set(auth(people[attacker].token)).send(body));
      expect([404]).toContain(r.status);
    }
    expect(pythonCalls).toBe(0);
    const mine = await h.http().get(`/episodes/${owned[0]}`).set(auth(people[0].token));
    expect(mine.status).toBe(200);
    owners200++;
    expect(pythonCalls).toBeGreaterThan(0);
    spy.mockRestore();
    expect(owners200).toBe(1);
  }, 300_000);

  it("the same seed gives the same blind chart through the gateway (reproducibility)", async () => {
    const { token } = await register(h, "Repro");
    const a = (await create(token, { kind: "real", n_bars: 120, seed: 77 })).body.episode_id;
    const b = (await create(token, { kind: "real", n_bars: 120, seed: 77 })).body.episode_id;
    const ba = (await h.http().get(`/episodes/${a}/bars`).set(auth(token))).body.bars;
    const bb = (await h.http().get(`/episodes/${b}/bars`).set(auth(token))).body.bars;
    expect(ba).toEqual(bb);
    expect(ba[0].close).toBe(100);
  });
});
