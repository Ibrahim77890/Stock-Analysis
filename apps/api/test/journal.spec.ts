import Ajv from "ajv";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { repoRoot } from "../src/config/paths";
import { auth, HAS_DB, Harness, register, resetAppTables, startApp } from "./helpers";

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

const NOT_FOUND = { statusCode: 404, message: "That episode was not found." };
const LEAK = /AAPL|2015-03-02|"kind":"real"|start_date|client_key|"symbol"/;

describe.skipIf(!HAS_DB)("indicators and decisions through the gateway (database, fake Python)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); h.fake.calls.length = 0; h.fake.leak = false; h.fake.failWith = undefined; });

  const newEp = async (t: string) => (await h.http().post("/episodes").set(auth(t)).send({ kind: "mixed" })).body.episode_id as string;
  const decide = (t: string, id: string, over: object = {}) =>
    h.http().post(`/episodes/${id}/decisions`).set(auth(t)).send({ stance: "long", reason: "Above its average.", client_key: "key-" + Math.random().toString(36).slice(2), ...over });
  const advance = (t: string, id: string, n = 1) => h.http().post(`/episodes/${id}/advance`).set(auth(t)).send({ n });

  it("needs a signed-in learner", async () => {
    expect((await h.http().get("/episodes/x/indicators?name=sma")).status).toBe(401);
    expect((await h.http().post("/episodes/x/decisions").send({})).status).toBe(401);
    expect((await h.http().get("/episodes/x/decisions")).status).toBe(401);
  });

  it("indicators: only the days revealed, the reply validates, and it grows after advancing", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    const a = await h.http().get(`/episodes/${id}/indicators?name=sma&window=20`).set(auth(token));
    expect(a.status).toBe(200);
    expect(validates("IndicatorDto", a.body)).toEqual([]);
    expect(a.body.values.at(-1).day).toBe(a.body.day);
    await advance(token, id, 3);
    const b = await h.http().get(`/episodes/${id}/indicators?name=sma&window=20`).set(auth(token));
    expect(b.body.values.at(-1).day).toBe(a.body.day + 3);
    expect((await h.http().get(`/episodes/${id}/indicators?name=rsi`).set(auth(token))).body.window).toBe(20);
  });

  it("indicators: bad name or window is a plain 422 (after the ownership check)", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    for (const q of ["name=macd", "name=sma&window=1", "name=sma&window=201", "name=sma&window=abc", "name=sma&window=2.5"]) {
      const r = await h.http().get(`/episodes/${id}/indicators?${q}`).set(auth(token));
      expect(r.status, q).toBe(422);
      expect(r.body.message).toMatch(/^(Please choose|The window)/);
    }
  });

  it("a decision: pending then marked after a day; same key twice is one decision; the reply validates", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    const body = { stance: "long", reason: "Above its average.", client_key: "key-abcdef-1" };
    const a = await h.http().post(`/episodes/${id}/decisions`).set(auth(token)).send(body);
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ created: true, status: "pending", result: null });
    expect(validates("DecisionDto", a.body)).toEqual([]);
    const b = await h.http().post(`/episodes/${id}/decisions`).set(auth(token)).send(body);
    expect(b.body.created).toBe(false);
    await advance(token, id);
    const j = await h.http().get(`/episodes/${id}/decisions`).set(auth(token));
    expect(validates("JournalDto", j.body)).toEqual([]);
    expect(j.body.decisions).toHaveLength(1);
    expect(j.body.decisions[0].status).toBe("marked");
    expect(j.body.totals).toMatchObject({ decisions: 1, marked: 1, pending: 0 });
  });

  it("a second decision on the same day is a plain 422 with the Python sentence", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    await decide(token, id);
    const r = await decide(token, id, { stance: "flat" });
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/already recorded a decision for this day/);
  });

  it("input checks: stance, reason, client key, cost", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    for (const bad of [{ stance: "short" }, { reason: "" }, { reason: "x".repeat(281) }, { client_key: "abc" }, { cost_bps: 51 }, { cost_bps: "a" }, { extra: 1 }]) {
      expect((await decide(token, id, bad)).status, JSON.stringify(bad).slice(0, 30)).toBe(422);
    }
    expect(h.fake.calls.filter((c) => c === "recordDecision")).toHaveLength(0);
  });

  it("ISOLATION FUZZ: 100 cross-access attempts get the same 404 and cause zero Python calls", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const ea = await newEp(a.token), eb = await newEp(b.token);
    h.fake.calls.length = 0;
    const paths: Array<[string, string, object?]> = [
      ["get", `/episodes/${eb}/indicators?name=sma`], ["get", `/episodes/${eb}/decisions`], ["post", `/episodes/${eb}/decisions`, { stance: "long", reason: "x", client_key: "abcdefgh1" }],
      ["get", `/episodes/nope/indicators?name=sma`], ["get", `/episodes/nope/decisions`],
    ];
    const bodies = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const [m, p, body] = paths[i % paths.length];
      const r = m === "get" ? await h.http().get(p).set(auth(a.token)) : await h.http().post(p).set(auth(a.token)).send(body);
      expect(r.status).toBe(404);
      const { request_id, ...rest } = r.body;
      bodies.add(JSON.stringify(rest));
    }
    expect(bodies).toEqual(new Set([JSON.stringify(NOT_FOUND)]));
    expect(h.fake.calls).toEqual([]);
    expect((await h.http().get(`/episodes/${ea}/decisions`).set(auth(a.token))).status).toBe(200);
  });

  it("WHITELIST: a Python that leaks symbol, dates, kind and the client key reaches no learner", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    h.fake.leak = true;
    const texts = [
      JSON.stringify((await h.http().get(`/episodes/${id}/indicators?name=sma`).set(auth(token))).body),
      JSON.stringify((await decide(token, id)).body),
      JSON.stringify((await h.http().get(`/episodes/${id}/decisions`).set(auth(token))).body),
    ];
    for (const t of texts) expect(t).not.toMatch(LEAK);
    expect(JSON.stringify({ symbol: "AAPL" })).toMatch(LEAK); // the scan really finds a leak (negative)
  });

  it("the 31st decision in a minute is 429 with Retry-After, others are unaffected, refused calls are not stored", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const ia = await newEp(a.token), ib = await newEp(b.token);
    const codes: number[] = [];
    for (let i = 0; i < 31; i++) codes.push((await decide(a.token, ia, { client_key: "same-key-0000" })).status);
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes[30]).toBe(429);
    const r = await decide(a.token, ia, { client_key: "same-key-0000" });
    expect(Number(r.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect((await decide(b.token, ib)).status).toBe(200);
    expect((await h.pool.query("SELECT count(*)::int AS n FROM app.rate_event WHERE kind = 'decision'")).rows[0].n).toBe(31);
  });

  it("upstream errors become plain messages; a revealed episode refuses a decision", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    await h.http().post(`/episodes/${id}/reveal`).set(auth(token)).send();
    const r = await decide(token, id);
    expect(r.status).toBe(409);
    h.fake.failWith = 502;
    const j = await h.http().get(`/episodes/${id}/decisions`).set(auth(token));
    expect(j.status).toBe(502);
    expect(j.body.message).toMatch(/number service/);
  });

  it("CONTRACT: a renamed field fails (negative)", async () => {
    const { token } = await register(h, "Ann");
    const id = await newEp(token);
    const j = (await h.http().get(`/episodes/${id}/decisions`).set(auth(token))).body;
    expect(validates("JournalDto", j)).toEqual([]);
    expect(validates("JournalDto", { ...j, totals: { ...j.totals, decision_count: 1 } }).length).toBeGreaterThan(0);
  });
});
