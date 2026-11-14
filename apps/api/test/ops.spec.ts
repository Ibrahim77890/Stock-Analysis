import Ajv from "ajv";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { repoRoot } from "../src/config/paths";
import { PythonClient } from "../src/python/python-client";
import { setRequestLogSink, TraceService } from "../src/trace/trace.service";
import { auth, HAS_DB, Harness, makeCfg, register, resetAppTables, startApp } from "./helpers";

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
ajv.addSchema(strict(JSON.parse(fs.readFileSync(path.join(repoRoot(), "docs/02-domain/openapi-gateway.json"), "utf8"))), "doc");
const validates = (schema: string, body: unknown): string[] => {
  const v = ajv.getSchema(`doc#/components/schemas/${schema}`)!;
  return v(body) ? [] : (v.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
};

const OP = "operator-token-for-tests-0123456789";

describe("the request id is forwarded to Python", () => {
  afterEach(() => vi.restoreAllMocks());
  it("every call to Python carries the id of the request being served; with no request there is no header", async () => {
    const seen: Array<Record<string, string>> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u: any, init: any) => { seen.push(init.headers); return new Response("{}", { status: 200 }); });
    const trace = new TraceService();
    const client = new PythonClient(makeCfg({ pythonApiUrl: "http://python.internal:8000" }), trace);
    const live = { entry: { request_id: "rid-1234", time: "", method: "GET", route: "", status: 0, duration_ms: 0, upstream: [] } as any };
    await trace.run(live, () => client.getEpisode("e1"));
    await client.getEpisode("e2");
    expect(seen[0]["x-request-id"]).toBe("rid-1234");
    expect(seen[1]["x-request-id"]).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)("operations (database, fake Python)", () => {
  let h: Harness;
  const lines: any[] = [];
  beforeAll(async () => { h = await startApp({ operatorToken: OP }); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); await h.pool.query("TRUNCATE app.request_log"); h.fake.leak = false; h.fake.calls.length = 0; lines.length = 0; setRequestLogSink((l) => lines.push(JSON.parse(l))); });
  afterEach(() => setRequestLogSink((l) => process.env.REQUEST_LOG !== "off" && process.stdout.write(l + "\n")));

  it("/metrics: no token, a wrong token and a learner token all get 401; the right token gets 200", async () => {
    const { token } = await register(h, "Ann");
    expect((await h.http().get("/metrics")).status).toBe(401);
    expect((await h.http().get("/metrics").set("x-operator-token", "wrong")).status).toBe(401);
    expect((await h.http().get("/metrics").set(auth(token))).status).toBe(401);
    expect((await h.http().get("/metrics").set("x-operator-token", token)).status).toBe(401);
    const ok = await h.http().get("/metrics").set("x-operator-token", OP);
    expect(ok.status).toBe(200);
    expect(validates("MetricsDto", ok.body)).toEqual([]);
  });

  it("/metrics is closed when no operator token is configured", async () => {
    const closed = await startApp({});
    try { expect((await closed.http().get("/metrics").set("x-operator-token", OP)).status).toBe(401); } finally { await closed.close(); }
  });

  it("RECONCILIATION: counts, error classes and percentiles equal the table and a hand computation", async () => {
    const { id } = await register(h, "Ann");
    const rows = [[120, 200], [130, 200], [140, 404], [2000, 500]];
    for (const [ms, status] of rows) {
      await h.pool.query("INSERT INTO app.request_log (request_id, learner_id, at, method, route, status, duration_ms) VALUES (gen_random_uuid(), $1, now(), 'GET', 'GET /demo/:id', $2, $3)", [id, status, ms]);
    }
    await h.pool.query("INSERT INTO app.request_log (request_id, learner_id, at, method, route, status, duration_ms) VALUES (gen_random_uuid(), $1, now() - interval '30 hours', 'GET', 'GET /old', 200, 5)", [id]);
    const r = await h.http().get("/metrics?hours=24").set("x-operator-token", OP);
    const demo = r.body.gateway.routes.find((x: any) => x.route === "GET /demo/:id");
    expect(demo).toMatchObject({ count: 4, client_errors: 1, server_errors: 1, p50_ms: 135, max_ms: 2000 });
    expect(demo.p95_ms).toBeCloseTo(1721, 3);
    expect(r.body.gateway.routes.find((x: any) => x.route === "GET /old")).toBeUndefined(); // outside the window
    const direct = (await h.pool.query("SELECT count(*)::int AS n FROM app.request_log WHERE route = 'GET /demo/:id'")).rows[0].n;
    expect(demo.count).toBe(direct);
    expect((await h.http().get("/metrics?hours=48").set("x-operator-token", OP)).body.gateway.routes.some((x: any) => x.route === "GET /old")).toBe(true);
  });

  it("/metrics holds no learner id, request id, token or body, and includes Python's numbers; a down Python only removes that part", async () => {
    const { token, id } = await register(h, "Ann");
    await h.http().get("/me").set(auth(token));
    await h.http().get("/trace").set(auth(token));
    const r = await h.http().get("/metrics").set("x-operator-token", OP);
    const text = JSON.stringify(r.body);
    for (const bad of [id, token, "Ann", "correct horse"]) expect(text.includes(bad), bad).toBe(false);
    expect(r.body.python.service).toBe("python");
    h.fake.leak = true;
    expect(JSON.stringify((await h.http().get("/metrics").set("x-operator-token", OP)).body)).not.toContain("secret");
    h.fake.metrics = async () => { throw new Error("down"); };
    const down = await h.http().get("/metrics").set("x-operator-token", OP);
    expect(down.status).toBe(200);
    expect(down.body.python).toBeUndefined();
  });

  it("/metrics: hours must be a whole number from 1 to 168", async () => {
    for (const q of ["0", "169", "x", "2.5"]) expect((await h.http().get(`/metrics?hours=${q}`).set("x-operator-token", OP)).status, q).toBe(422);
  });

  it("/data/status needs a learner, is whitelisted, cached for a minute, and validates", async () => {
    expect((await h.http().get("/data/status")).status).toBe(401);
    const { token } = await register(h, "Ann");
    h.fake.leak = true;
    const r = await h.http().get("/data/status").set(auth(token));
    expect(r.status).toBe(200);
    expect(validates("DataStatusDto", r.body)).toEqual([]);
    const text = JSON.stringify(r.body);
    for (const bad of ["file_path", "file_sha256", ".csv", "api_key_name", "TIINGO_API_KEY", "data/raw"]) expect(text).not.toContain(bad);
    expect(r.body.caveats.length).toBeGreaterThanOrEqual(4);
    await h.http().get("/data/status").set(auth(token));
    expect(h.fake.calls.filter((c) => c === "dataStatus")).toHaveLength(1); // second call came from the cache
  });

  it("JSON request lines: one per request including anonymous ones, route patterns only, no secret, id, body or query", async () => {
    const { token, id } = await register(h, "Ann");
    await h.http().post("/auth/login").send({ display_name: "Ann", password: "wrong password here" });
    const ep = (await h.http().post("/episodes").set(auth(token)).send({ kind: "mixed" })).body.episode_id;
    await h.http().get(`/episodes/${ep}/bars?secret=1`).set(auth(token));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(Object.keys(l).sort()).toEqual(["duration_ms", "method", "request_id", "route", "service", "status", "time"]);
    const text = JSON.stringify(lines);
    for (const bad of [id, token, ep, "wrong password", "correct horse", "secret=1", "Ann"]) expect(text.includes(bad), bad).toBe(false);
    expect(lines.map((l) => l.route)).toEqual(expect.arrayContaining(["/auth/login", "/episodes/:id/bars"]));
    expect(lines.find((l) => l.route === "/auth/login")).toMatchObject({ method: "POST", status: 401 });
  });
});
