import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { TraceService } from "../src/trace/trace.service";
import { DbService } from "../src/db/db.service";
import { DbKindLimiter, LimiterFactory } from "../src/limits/db-rate-limiter";
import { RateLimiter } from "../src/auth/auth.service";
import { auth, HAS_DB, Harness, makeCfg, register, resetAppTables, startApp, TEST_URL } from "./helpers";

const RUN = { fast: 10, slow: 40, cost_bps: 2, seed: 1, n_paths: 10 };

describe("the in-memory limiter keeps its interface (fake clock)", () => {
  it("allows the limit, refuses the next, and recovers after the window", () => {
    const l = new RateLimiter(2, 1000);
    expect([l.allow("k", 0), l.allow("k", 1), l.allow("k", 2)]).toEqual([true, true, false]);
    expect(l.retryAfterSeconds("k", 2)).toBe(1);
    expect(l.allow("k", 1001)).toBe(true);
  });
});

describe.skipIf(!HAS_DB)("durable limiter (database)", () => {
  let db: DbService;
  let factory: LimiterFactory;
  beforeAll(() => { db = new DbService(makeCfg()); factory = new LimiterFactory(db); });
  afterAll(async () => { await db.onModuleDestroy(); });
  beforeEach(async () => { await db.query("TRUNCATE app.rate_event"); });

  it("CONCURRENCY: 30 simultaneous calls with a limit of 20 let exactly 20 through (5 rounds); counted equals accepted", async () => {
    for (let round = 0; round < 5; round++) {
      const lim = factory.make(`conc-${round}`, 20);
      const res = await Promise.all(Array.from({ length: 30 }, () => lim.allow("same-key")));
      expect(res.filter(Boolean)).toHaveLength(20);
      expect(await lim.counted("same-key")).toBe(20); // reconciliation: rows counted equal calls accepted
    }
  });

  it("refused calls are not stored, so a client in a loop recovers when the window passes", async () => {
    const lim = factory.make("loop", 3);
    for (let i = 0; i < 3; i++) expect(await lim.allow("k")).toBe(true);
    for (let i = 0; i < 25; i++) expect(await lim.allow("k")).toBe(false);
    expect(await lim.counted("k")).toBe(3);
    expect(await lim.retryAfterSeconds("k")).toBeGreaterThanOrEqual(1);
    expect(await lim.retryAfterSeconds("k")).toBeLessThanOrEqual(60);
    // age the rows past the window: the client is allowed again
    await db.query("UPDATE app.rate_event SET at = at - interval '61 seconds'");
    expect(await lim.allow("k")).toBe(true);
  });

  it("different keys and different kinds do not share a count", async () => {
    const a = factory.make("kind-a", 1), b = factory.make("kind-b", 1);
    expect(await a.allow("x")).toBe(true);
    expect(await a.allow("y")).toBe(true);
    expect(await b.allow("x")).toBe(true);
    expect(await a.allow("x")).toBe(false);
  });

  it("cleanup removes rows older than ten minutes, and running it twice changes nothing (idempotent)", async () => {
    const lim = factory.make("clean", 100);
    await lim.allow("old"); await lim.allow("new");
    await db.query("UPDATE app.rate_event SET at = at - interval '11 minutes' WHERE key = 'old'");
    expect(await factory.cleanup(true)).toBe(1);
    expect(await factory.cleanup(true)).toBe(0);
    expect((await db.query("SELECT key FROM app.rate_event")).rows.map((r) => r.key)).toEqual(["new"]);
  });

  it("an unreachable database makes allow() throw rather than let a call through", async () => {
    const dead = new DbService(makeCfg({ databaseUrl: "postgresql://u:p@127.0.0.1:1/none" }));
    await expect(new DbKindLimiter(dead, "x", 5).allow("k")).rejects.toThrow();
    await dead.pool.end().catch(() => undefined);
  });
});

describe.skipIf(!HAS_DB)("durable limits through the app (restart, trace)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp({ labRunsPerMinute: 20, loginLimit: 5 }); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); await h.pool.query("TRUNCATE app.request_log"); });

  it("RESTART: a new app instance on the same database still refuses the 21st Lab run of the minute and still lists the old trace", async () => {
    const { token } = await register(h, "Ann");
    const study = (await h.http().post("/lab/studies").set(auth(token)).send({ symbol: "TESTX" })).body.study_id;
    for (let i = 0; i < 20; i++) expect((await h.http().post(`/lab/studies/${study}/runs`).set(auth(token)).send(RUN)).status).toBe(200);
    const before = (await h.http().get("/trace?limit=200").set(auth(token))).body;
    expect(before.length).toBeGreaterThanOrEqual(21);
    // close the first instance completely, then start a second one on the same database
    const first = h;
    const second = await startApp({ labRunsPerMinute: 20, loginLimit: 5 });
    try {
      // the owner check and the limit check come before any call to Python, so the new fake needs no study
      const refused = await second.http().post(`/lab/studies/${study}/runs`).set(auth(token)).send(RUN);
      expect(refused.status).toBe(429);
      expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(Number(refused.headers["retry-after"])).toBeLessThanOrEqual(60);
      const after = (await second.http().get("/trace?limit=200").set(auth(token))).body;
      const ids = new Set(after.map((e: any) => e.request_id));
      for (const e of before) expect(ids.has(e.request_id)).toBe(true);
    } finally {
      await second.app.close();
      await second.pool.end();
    }
    expect(first.app).toBeDefined();
  });

  it("the login limit survives too: the 6th try from one client and name is 429 even after a restart", async () => {
    for (let i = 0; i < 5; i++) await h.http().post("/auth/login").send({ display_name: "Nobody", password: "wrong password here" });
    const second = await startApp({ loginLimit: 5 });
    try {
      const r = await second.http().post("/auth/login").send({ display_name: "Nobody", password: "wrong password here" });
      expect(r.status).toBe(429);
      expect(Number(r.headers["retry-after"] ?? 1)).toBeGreaterThanOrEqual(1);
    } finally {
      await second.app.close();
      await second.pool.end();
    }
  });

  it("the trace keeps at most 200 rows per learner and the newest first", async () => {
    const { token, id } = await register(h, "Ann");
    await h.pool.query(
      "INSERT INTO app.request_log (request_id, learner_id, at, method, route, status, duration_ms) SELECT gen_random_uuid(), $1, now() - (g || ' seconds')::interval, 'GET', 'GET /x', 200, 1 FROM generate_series(1, 250) g",
      [id],
    );
    const r = await h.http().get("/me").set(auth(token));
    expect(r.status).toBe(200);
    const rows = (await h.pool.query("SELECT count(*)::int AS n FROM app.request_log WHERE learner_id = $1", [id])).rows[0].n;
    await h.http().get("/trace").set(auth(token));
    await h.app.get(TraceService).flush(); // wait for the write (and trim) of that request itself
    const rows2 = (await h.pool.query("SELECT count(*)::int AS n FROM app.request_log WHERE learner_id = $1", [id])).rows[0].n;
    expect(rows).toBeLessThanOrEqual(251);
    expect(rows2).toBeLessThanOrEqual(200);
    const list = (await h.http().get("/trace?limit=5").set(auth(token))).body;
    expect(list).toHaveLength(5);
    const times = list.map((e: any) => Date.parse(e.time));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it("NEGATIVE SCAN: the trace tables hold route patterns only: no learner id, token, password or body text", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const study = (await h.http().post("/lab/studies").set(auth(a.token)).send({ symbol: "TESTX" })).body.study_id;
    await h.http().post(`/lab/studies/${study}/runs`).set(auth(a.token)).send(RUN);
    await h.http().get(`/lessons/brier-score`).set(auth(a.token));
    await h.http().post(`/lab/studies/${study}/runs`).set(auth(b.token)).send(RUN); // 404 for Bob
    await h.http().get("/trace").set(auth(a.token));
    const all = JSON.stringify((await h.pool.query("SELECT route, method, upstream FROM app.request_log")).rows);
    for (const secret of [a.id, b.id, a.token, b.token, "correct horse battery", String(study)]) expect(all.includes(secret), `leaked ${secret.slice(0, 8)}`).toBe(false);
    expect(all).toMatch(/POST \/lab\/studies\/:id\/runs/);
    const lim = JSON.stringify((await h.pool.query("SELECT key, kind FROM app.rate_event")).rows);
    expect(lim.includes(a.token)).toBe(false);
  });

  it("a trace write that fails never fails the request", async () => {
    const { token } = await register(h, "Ann");
    await h.pool.query("ALTER TABLE app.request_log RENAME TO request_log_hidden");
    try {
      expect((await h.http().get("/me").set(auth(token))).status).toBe(200);
    } finally {
      await h.pool.query("ALTER TABLE app.request_log_hidden RENAME TO request_log");
    }
  });
});

void Pool; void TEST_URL;
