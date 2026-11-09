import Ajv from "ajv";
import { ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as path from "node:path";
import { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

/** Full Tiingo history of a few symbols, copied from the real database into the throwaway test database. */
async function seedTiingo(real: Pool, test: Pool, symbols: string[]): Promise<void> {
  await test.query("TRUNCATE market.bar_daily, market.corporate_action, market.ingestion_job, market.instrument RESTART IDENTITY CASCADE");
  await test.query("TRUNCATE research.lab_study, research.trial, research.study RESTART IDENTITY CASCADE");
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

// ---- the vault leak scan: any date after the practice end, a vault key, or a vault-era year anywhere in a reply
const ISO = /\d{4}-\d{2}-\d{2}/g;
// fields that would reveal the vault (counts such as vault_years, vault_bars and the flag vault_open are allowed)
const VAULT_KEYS = /"(practice_end|vault_start|vault_end|vault_date|vault_dates|vault_rule|vault_total_return)"/;
/** Strings (and the number under a key called "year") of a JSON-like value. Other numbers, such as growth values like 2088.3, are not years. */
function textOf(o: unknown, key = ""): string[] {
  if (key === "created_at" || key === "request_id" || key === "x-request-id") return []; // when the learner made the study: the learner's own clock, not market data (exempt, with request ids, which are random UUIDs whose four-digit groups can look like years)
  if (typeof o === "string") return [o];
  if (typeof o === "number") return key === "year" ? [String(o)] : [];
  if (Array.isArray(o)) return o.flatMap((v) => textOf(v, key));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => [k, ...textOf(v, k)]);
  return [];
}
/** Any date after the practice end, a vault-era year, or a vault key in a reply (body, error body and headers). The Date header is the server's own clock, so it is exempt. */
export function leakFindings(label: string, body: unknown, headers: Record<string, unknown>, practiceEnd: string): string[] {
  const { date: _clock, ...otherHeaders } = headers as Record<string, unknown>;
  const text = [...textOf(body), ...textOf(otherHeaders)].join(" | ");
  const found: string[] = [];
  for (const d of text.match(ISO) ?? []) if (d > practiceEnd) found.push(`${label}: date ${d} after the practice end`);
  const endYear = Number(practiceEnd.slice(0, 4));
  for (const y of text.match(/\b(20\d\d)\b/g) ?? []) if (Number(y) > endYear) found.push(`${label}: year ${y} after the practice end`);
  const key = (JSON.stringify(body) + JSON.stringify(otherHeaders)).match(VAULT_KEYS);
  if (key) found.push(`${label}: vault key ${key[0]}`);
  return found;
}

describe("the leak scan itself (negative)", () => {
  it("flags a planted practice_end, a later date and a vault-era year", () => {
    expect(leakFindings("x", { practice_end: "2021-12-29" }, {}, "2021-12-29").length).toBeGreaterThan(0);
    expect(leakFindings("x", { d: "2022-01-10" }, {}, "2021-12-29").length).toBeGreaterThan(0);
    expect(leakFindings("x", { yearly: [{ year: 2023 }] }, {}, "2021-12-29").length).toBeGreaterThan(0);
    expect(leakFindings("x", { vault_end: "x" }, {}, "2021-12-29").length).toBeGreaterThan(0);
    expect(leakFindings("x", { growth: [2088.3, 2084.1], vault_years: 4, vault_open: false, created_at: "2026-11-09T10:00:00Z" }, { date: "Mon, 09 Nov 2026" }, "2021-12-29")).toEqual([]);
    expect(leakFindings("x", { d: "2021-12-29", yearly: [{ year: 2021 }] }, {}, "2021-12-29")).toEqual([]);
  });
});

describe.skipIf(!CAN_RUN)("Strategy Lab on the real stack: real gateway + real Python service + database", () => {
  let py: ChildProcess;
  let h: Harness;
  let real: Pool;
  let test: Pool;
  let pyBase = "";
  const pyCalls: string[] = [];
  const realFetch = globalThis.fetch;

  const counts = async () => (await test.query("SELECT (SELECT count(*)::int FROM research.study) s, (SELECT count(*)::int FROM research.trial) t, (SELECT count(*)::int FROM research.lab_study) l, (SELECT count(*)::int FROM app.learner_study) a")).rows[0];
  const practiceEnd = async (id: number) => String((await test.query("SELECT practice_end::text d FROM research.lab_study WHERE study_id=$1", [id])).rows[0].d);
  const newStudy = (t: string, symbol: string) => h.http().post("/lab/studies").set(auth(t)).send({ symbol });
  const run = (t: string, id: number | string, body: object) => h.http().post(`/lab/studies/${id}/runs`).set(auth(t)).send(body);
  let learnerNo = 0;
  const learner = async () => (await register(h, `Lab${++learnerNo}`)).token;

  beforeAll(async () => {
    real = new Pool({ connectionString: REAL_URL, max: 1 });
    test = new Pool({ connectionString: TEST_URL, max: 2 });
    await seedTiingo(real, test, SYMBOLS);
    const port = await free();
    pyBase = `http://127.0.0.1:${port}`;
    py = spawn(PY, ["-m", "market_data.cli", "serve", "--port", String(port)], {
      cwd: path.join(ROOT, "services", "market-data"), env: { ...process.env, DATABASE_URL: TEST_URL!, INTERNAL_API_TOKEN: SECRETS.internal }, stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await realFetch(pyBase + "/health")).ok) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    const cfg = makeCfg({ pythonApiUrl: pyBase, labRunsPerMinute: 20 });
    const app = await buildApp(cfg);
    await app.listen(0, "127.0.0.1"); // one listening server for the whole spec (hundreds of requests)
    const base = await app.getUrl();
    const pool = new Pool({ connectionString: TEST_URL, max: 2 });
    await resetAppTables(pool);
    h = { app, fake: {} as any, cfg, pool, http: () => request(base), close: async () => { await pool.end(); await app.close(); } };
    vi.spyOn(globalThis, "fetch").mockImplementation((input: any, init?: any) => { const u = String(input?.url ?? input); if (u.startsWith(pyBase)) pyCalls.push(u); return realFetch(input, init); });
  }, 180_000);

  afterAll(async () => { vi.restoreAllMocks(); await h?.close(); py?.kill(); await real?.end(); await test?.end(); });

  it("vault leak fuzz: 3 stocks x 2 learners x 20 random rules, every reply, error body and header scanned; contracts validate", async () => {
    let seed = 5;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const findings: string[] = [];
    let runs = 0;
    for (const symbol of SYMBOLS) {
      for (let who = 0; who < 2; who++) {
        const t = await learner(); // a learner may run 20 times a minute, so each study gets its own learner
        const made = await newStudy(t, symbol);
        expect(made.status).toBe(200);
        expect(validates("StudyCreatedDto", made.body)).toEqual([]);
        const id = made.body.study_id;
        const end = await practiceEnd(id);
        const scan = (label: string, r: any) => findings.push(...leakFindings(`${symbol} ${label}`, r.body, r.headers, end));
        scan("create", made);
        for (let i = 0; i < 20; i++) {
          const fast = 2 + rnd(150), slow = fast + 1 + rnd(299 - fast), cost = rnd(51);
          const r = await run(t, id, { fast, slow, cost_bps: cost, n_paths: 10 });
          expect(r.status).toBe(200);
          runs++;
          scan(`run ${fast}/${slow}/${cost}`, r);
          expect(validates("LabRunDto", r.body)).toEqual([]);
        }
        // the other routes before the vault is opened, errors included
        scan("overview", await h.http().get(`/lab/studies/${id}`).set(auth(t)));
        scan("list", await h.http().get("/lab/studies").set(auth(t)));
        scan("stocks", await h.http().get("/lab/stocks").set(auth(t)));
        scan("saved vault while closed", await h.http().get(`/lab/studies/${id}/vault`).set(auth(t)));
        scan("vault without confirm", await h.http().post(`/lab/studies/${id}/vault`).set(auth(t)).send({ fast: 5, slow: 20, cost_bps: 2 }));
        scan("vault for an untried rule", await h.http().post(`/lab/studies/${id}/vault`).set(auth(t)).send({ fast: 3, slow: 299, cost_bps: 49, confirm: true }));
        scan("invalid rule", await run(t, id, { fast: 50, slow: 10, cost_bps: 2 }));
        scan("another's study", await h.http().get(`/lab/studies/${id}`).set(auth(await learner())));
      }
    }
    expect(runs).toBe(120);
    expect(findings).toEqual([]);
  }, 900_000);

  it("practice results do not depend on vault data: 10 rules give byte-identical results after the vault rows are deleted", async () => {
    const t = await learner();
    const made = await newStudy(t, "AAPL");
    const id = made.body.study_id;
    const end = await practiceEnd(id);
    const rules = Array.from({ length: 10 }, (_, i) => ({ fast: 3 + i * 3, slow: 40 + i * 17, cost_bps: i % 4 * 5, n_paths: 10 }));
    // the ideas-tried count (and so the meter) legitimately depends on how many rules were run before; everything else must not change
    const strip = (b: any) => { const { counted, trial_count, overfitting_meter, ...rest } = b; return JSON.stringify(rest); };
    const before: string[] = [];
    for (const r of rules) before.push(strip((await run(t, id, r)).body));
    await test.query("DELETE FROM market.bar_daily WHERE trade_date > $1", [end]);
    await test.query("DELETE FROM market.corporate_action WHERE ex_date > $1", [end]);
    const after: string[] = [];
    for (const r of rules) after.push(strip((await run(t, id, r)).body));
    expect(after).toEqual(before);
    await seedTiingo(real, test, SYMBOLS); // restore the vault rows for the other tests
    await resetAppTables(h.pool);
  }, 300_000);

  it("study isolation fuzz: 200 cross-access attempts all get the same 404 (401 without a token) and cause zero Python calls", async () => {
    const a = await learner(), b = await learner();
    const sa = (await newStudy(a, "AAPL")).body.study_id, sb = (await newStudy(b, "MSFT")).body.study_id;
    await run(a, sa, { fast: 10, slow: 40, cost_bps: 2, n_paths: 10 });
    pyCalls.length = 0;
    const routes: Array<[string, (id: string) => string, object?]> = [
      ["get", (id) => `/lab/studies/${id}`], ["post", (id) => `/lab/studies/${id}/runs`, { fast: 10, slow: 40, cost_bps: 2 }],
      ["post", (id) => `/lab/studies/${id}/vault`, { fast: 10, slow: 40, cost_bps: 2, confirm: true }], ["get", (id) => `/lab/studies/${id}/vault`],
    ];
    let seed = 3;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let first: string | undefined;
    for (let i = 0; i < 200; i++) {
      const [method, p, body] = routes[Math.floor(rnd() * routes.length)];
      const aAttacks = rnd() < 0.5;
      const id = rnd() < 0.15 ? "99999999" : rnd() < 0.1 ? "x1" : String(aAttacks ? sb : sa);
      const req = (h.http() as any)[method](p(id)).set(auth(aAttacks ? a : b));
      const r = body ? await req.send(body) : await req;
      expect(r.status).toBe(404);
      first ??= JSON.stringify({ ...r.body, request_id: undefined });
      expect(JSON.stringify({ ...r.body, request_id: undefined })).toBe(first);
      expect((await (h.http() as any)[method](p(String(sa)))).status).toBe(401);
    }
    expect(pyCalls).toEqual([]);
    expect((await h.http().get(`/lab/studies/${sa}`).set(auth(a))).status).toBe(200);
  }, 120_000);

  it("every cap returns its status and leaves the counts unchanged; the 21st run in a minute is 429; a second vault is 409", async () => {
    const t = await learner();
    const id = (await newStudy(t, "KO")).body.study_id;
    const before = await counts();
    const bad: Array<[string, object, number]> = [
      ["fast >= slow", { fast: 40, slow: 40 }, 422], ["slow 301", { fast: 5, slow: 301 }, 422], ["fast 1", { fast: 1, slow: 20 }, 422],
      ["cost 51", { fast: 5, slow: 20, cost_bps: 51 }, 422], ["201 paths", { fast: 5, slow: 20, n_paths: 201 }, 422], ["9 paths", { fast: 5, slow: 20, n_paths: 9 }, 422],
    ];
    for (const [label, body, status] of bad) expect((await run(t, id, body)).status, label).toBe(status);
    expect(await counts()).toEqual(before);
    for (let i = 0; i < 20; i++) expect((await run(t, id, { fast: 5, slow: 20 + i, cost_bps: 2, n_paths: 10 })).status).toBe(200);
    const limited = await run(t, id, { fast: 5, slow: 99, cost_bps: 2, n_paths: 10 });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    const afterRuns = await counts();
    expect(afterRuns.t - before.t).toBe(20); // only the accepted runs were recorded
    const t2 = await learner();
    const id2 = (await newStudy(t2, "KO")).body.study_id;
    expect((await run(t2, id2, { fast: 5, slow: 20, cost_bps: 2, n_paths: 10 })).status).toBe(200);
    const open = await h.http().post(`/lab/studies/${id2}/vault`).set(auth(t2)).send({ fast: 5, slow: 20, cost_bps: 2, confirm: true });
    expect(open.status).toBe(200);
    expect(validates("VaultResultDto", open.body)).toEqual([]);
    const again = await h.http().post(`/lab/studies/${id2}/vault`).set(auth(t2)).send({ fast: 5, slow: 20, cost_bps: 2, confirm: true });
    expect(again.status).toBe(409);
    const saved = await h.http().get(`/lab/studies/${id2}/vault`).set(auth(t2));
    expect(saved.body.rule).toEqual(open.body.rule);
    // the 21st study of a learner
    const t3 = await learner();
    for (let i = 0; i < 20; i++) expect((await newStudy(t3, "AAPL")).status).toBe(200);
    const beforeCap = await counts();
    expect((await newStudy(t3, "AAPL")).status).toBe(422);
    expect(await counts()).toEqual(beforeCap);
  }, 300_000);

  it("the largest allowed run: time, size and contract; a rename of a field fails the contract (negative)", async () => {
    const t = await learner();
    const id = (await newStudy(t, "AAPL")).body.study_id;
    const t0 = Date.now();
    const r = await run(t, id, { fast: 5, slow: 300, cost_bps: 2, n_paths: 200 });
    const secs = (Date.now() - t0) / 1000;
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body).length).toBeLessThan(150_000);
    expect(secs).toBeLessThan(30);
    expect(r.body.growth.dates.length).toBeLessThanOrEqual(300);
    expect(validates("LabRunDto", r.body)).toEqual([]);
    const renamed = { ...r.body, total: r.body.trial_count }; delete (renamed as any).trial_count;
    expect(validates("LabRunDto", renamed).length).toBeGreaterThan(0);
    for (const [schema, body] of [["StudyOverviewDto", (await h.http().get(`/lab/studies/${id}`).set(auth(t))).body], ["StocksDto", (await h.http().get("/lab/stocks").set(auth(t))).body]] as const) expect(validates(schema, body)).toEqual([]);
    expect(validates("StudyListItemDto", (await h.http().get("/lab/studies").set(auth(t))).body[0])).toEqual([]);
    console.log(`largest run (slow 300, 200 mixed-up histories) through the gateway: ${secs.toFixed(1)} s, ${(JSON.stringify(r.body).length / 1000).toFixed(1)} KB`);
  }, 120_000);

  it("a Python service that never answers gives a plain 504 after 30 seconds, with no URL or token in the message", async () => {
    const slow = http.createServer(() => { /* never answers */ });
    await new Promise<void>((res) => slow.listen(0, "127.0.0.1", res));
    const port = (slow.address() as net.AddressInfo).port;
    const app = await buildApp(makeCfg({ pythonApiUrl: `http://127.0.0.1:${port}` }));
    await app.init();
    try {
      const t = await (async () => (await request(app.getHttpServer()).post("/auth/register").send({ display_name: "Slow" + Date.now(), password: "correct horse battery" })).body)();
      const me = await request(app.getHttpServer()).get("/me").set(auth(t.token));
      await test.query("INSERT INTO app.learner_study (learner_id, study_id, symbol) VALUES ($1, 424242, 'AAPL') ON CONFLICT DO NOTHING", [me.body.learner_id]);
      const r = await request(app.getHttpServer()).post("/lab/studies/424242/runs").set(auth(t.token)).send({ fast: 5, slow: 20, cost_bps: 2 });
      expect(r.status).toBe(504);
      expect(JSON.stringify(r.body)).not.toMatch(/http|127\.0\.0\.1|token|upstream/i);
    } finally {
      await test.query("DELETE FROM app.learner_study WHERE study_id = 424242");
      await app.close();
      slow.closeAllConnections?.();
      slow.close();
    }
  }, 90_000);
});
