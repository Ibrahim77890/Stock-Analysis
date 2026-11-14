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
import { setRequestLogSink } from "../src/trace/trace.service";
import { auth, HAS_DB, Harness, makeCfg, register, resetAppTables, SECRETS, TEST_URL } from "./helpers";

loadEnvFile();
const REAL_URL = process.env.DATABASE_URL;
const ROOT = repoRoot();
const PY = path.join(ROOT, "services", "market-data", ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const CAN_RUN = HAS_DB && Boolean(REAL_URL) && fs.existsSync(PY);
const OP = "operator-token-for-obs-e2e-0123456789";
const free = (): Promise<number> => new Promise((res) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });

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

/** Findings in captured log lines: any configured secret, learner id, token or body text. */
export function logFindings(lines: string[], secrets: string[]): string[] {
  const out: string[] = [];
  for (const [i, line] of lines.entries()) for (const s of secrets) if (s && line.includes(s)) out.push(`line ${i} holds a secret or identifier (${s.slice(0, 4)}...)`);
  return out;
}

describe.skipIf(!CAN_RUN)("observability on the real stack (real Python on a free port, real database)", () => {
  let py: ChildProcess;
  let h: Harness;
  let test: Pool;
  let base = "";
  const pyLines: string[] = [];
  const gwLines: string[] = [];
  let pyBuf = "";

  const call = async (token: string | null, method: "GET" | "POST", p: string, body?: object, headers: Record<string, string> = {}) => {
    const res = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : method === "POST" ? "{}" : undefined });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json, id: res.headers.get("x-request-id") };
  };

  beforeAll(async () => {
    test = new Pool({ connectionString: TEST_URL, max: 2 });
    await test.query("TRUNCATE research.paper_decision, research.prediction, research.episode RESTART IDENTITY CASCADE");
    const port = await free();
    const pyBase = `http://127.0.0.1:${port}`;
    py = spawn(PY, ["-m", "market_data.cli", "serve", "--port", String(port)], {
      cwd: path.join(ROOT, "services", "market-data"), env: { ...process.env, DATABASE_URL: TEST_URL!, INTERNAL_API_TOKEN: SECRETS.internal }, stdio: ["ignore", "pipe", "ignore"],
    });
    py.stdout!.on("data", (d: Buffer) => {
      pyBuf += d.toString();
      let i;
      while ((i = pyBuf.indexOf("\n")) >= 0) { const l = pyBuf.slice(0, i).trim(); pyBuf = pyBuf.slice(i + 1); if (l.startsWith("{")) pyLines.push(l); }
    });
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(pyBase + "/health")).ok) break; } catch { /* not yet */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    setRequestLogSink((l) => gwLines.push(l));
    const cfg = makeCfg({ pythonApiUrl: pyBase, operatorToken: OP });
    const app = await buildApp(cfg);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
    const pool = new Pool({ connectionString: TEST_URL, max: 2 });
    await resetAppTables(pool);
    await pool.query("TRUNCATE app.request_log");
    h = { app, fake: {} as any, cfg, pool, http: () => request(base), close: async () => { await pool.end(); await app.close(); } };
  }, 180_000);

  afterAll(async () => { setRequestLogSink((l) => process.env.REQUEST_LOG !== "off" && process.stdout.write(l + "\n")); await h?.close(); py?.kill(); await test?.end(); });

  it("100 mixed calls: every request id the gateway sent to Python is in the Python log; no secret, id or body is in any log line; the planted secret is detected", async () => {
    const a = await register(h, "ObsAnn");
    const secrets = [a.token, a.id, SECRETS.jwt, SECRETS.internal, OP, "correct horse battery", "wrong password here", "Neutral note.", "ObsAnn"];
    await call(null, "POST", "/auth/login", { display_name: "ObsAnn", password: "wrong password here" });
    const ep = (await call(a.token, "POST", "/episodes", { kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 4 })).body.episode_id;
    secrets.push(ep);
    let n = 0, keyNo = 0;
    while (n < 100) {
      await call(a.token, "GET", `/episodes/${ep}/bars`); n++;
      await call(a.token, "GET", `/episodes/${ep}/indicators?name=sma&window=20`); n++;
      await call(a.token, "GET", "/lessons"); n++;
      await call(a.token, "GET", "/glossary"); n++;
      await call(a.token, "GET", "/does-not-exist"); n++;
      if (n % 10 === 0) { await call(a.token, "POST", `/episodes/${ep}/decisions`, { stance: "long", reason: "Neutral note.", client_key: `obs-key-${++keyNo}-abcdefgh` }); await call(a.token, "POST", `/episodes/${ep}/advance`, { n: 1 }); n += 2; }
      await h.pool.query("DELETE FROM app.rate_event");
    }
    await h.app.get((await import("../src/trace/trace.service")).TraceService).flush();
    await new Promise((r) => setTimeout(r, 500)); // let the Python process flush its last lines
    const parsedGw = gwLines.map((l) => JSON.parse(l));
    const pyIds = new Set(pyLines.map((l) => JSON.parse(l).request_id));
    const calledPython = (await h.pool.query("SELECT request_id::text AS id FROM app.request_log WHERE jsonb_array_length(upstream) > 0")).rows.map((r) => r.id);
    expect(calledPython.length).toBeGreaterThan(30);
    const missing = calledPython.filter((id) => !pyIds.has(id));
    expect(missing).toEqual([]);
    expect(parsedGw.length).toBeGreaterThanOrEqual(100);
    expect(parsedGw.every((l) => /^[0-9a-f-]{36}$/.test(l.request_id))).toBe(true);
    expect(logFindings([...gwLines, ...pyLines], secrets)).toEqual([]);
    // negative: the scan finds a planted secret
    expect(logFindings([...gwLines, JSON.stringify({ route: "/x", authorization: `Bearer ${a.token}` })], secrets).length).toBe(1);
    expect(pyLines.length).toBeGreaterThan(calledPython.length - 1);
  }, 240_000);

  it("the request id comes back in the response header and in Python's reply path (the same id appears in both logs for one call)", async () => {
    const a = await register(h, "ObsBob");
    const ep = (await call(a.token, "POST", "/episodes", { kind: "synthetic", n_bars: 120, initial_visible: 60, seed: 5 })).body.episode_id;
    const r = await call(a.token, "GET", `/episodes/${ep}/bars`);
    expect(r.id).toMatch(/^[0-9a-f-]{36}$/);
    await new Promise((res) => setTimeout(res, 500));
    expect(gwLines.some((l) => JSON.parse(l).request_id === r.id)).toBe(true);
    expect(pyLines.some((l) => JSON.parse(l).request_id === r.id)).toBe(true);
  }, 60_000);

  it("METRICS reconcile with the request log, and the contract validates (a renamed field fails)", async () => {
    const a = await register(h, "ObsCy");
    for (let i = 0; i < 7; i++) await call(a.token, "GET", "/lessons");
    await call(a.token, "GET", "/does-not-exist");
    await h.app.get((await import("../src/trace/trace.service")).TraceService).flush();
    const m = await call(null, "GET", "/metrics?hours=24", undefined, { "x-operator-token": OP });
    expect(m.status).toBe(200);
    expect(validates("MetricsDto", m.body)).toEqual([]);
    const lessons = m.body.gateway.routes.find((r: any) => r.route === "GET /lessons");
    const direct = (await h.pool.query("SELECT count(*)::int AS n FROM app.request_log WHERE route = 'GET /lessons' AND at > now() - interval '24 hours'")).rows[0].n;
    expect(lessons.count).toBe(direct);
    expect(m.body.python.routes.length).toBeGreaterThan(0);
    expect(validates("MetricsDto", { ...m.body, window: m.body.window_hours, window_hours: undefined }).length).toBeGreaterThan(0);
    expect((await call(a.token, "GET", "/metrics")).status).toBe(401);
  }, 60_000);

  it("DATA STATUS through the real stack: validates, holds no path or key, and equals the database; a renamed field fails", async () => {
    const a = await register(h, "ObsDee");
    const r = await call(a.token, "GET", "/data/status");
    expect(r.status).toBe(200);
    expect(validates("DataStatusDto", r.body)).toEqual([]);
    const text = JSON.stringify(r.body).toLowerCase();
    for (const bad of ["sha256", "file_name", ".csv", "data/raw", "api_key", "apikey", "http://", "https://"]) expect(text).not.toContain(bad);
    expect(r.body.caveats.length).toBeGreaterThanOrEqual(4);
    const bars = (await test.query("SELECT count(*)::int AS n FROM market.bar_daily")).rows[0].n;
    expect(r.body.sources.reduce((s: number, x: any) => s + x.bars, 0)).toBe(bars);
    expect(validates("DataStatusDto", { ...r.body, sources_list: r.body.sources, sources: undefined }).length).toBeGreaterThan(0);
  }, 60_000);
});
