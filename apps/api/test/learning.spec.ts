import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, HAS_DB, Harness, register, resetAppTables, startApp } from "./helpers";

const IDENTITY = /AAPL|Apple|2015-03-02|start_date|"symbol"/;

describe.skipIf(!HAS_DB)("learning gateway (database, fake Python)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); h.fake.calls.length = 0; h.fake.leak = false; h.fake.failWith = undefined; });

  const create = async (token: string, body: object = {}) => (await h.http().post("/episodes").set(auth(token)).send(body));

  it("a learner runs the whole loop through the gateway", async () => {
    const { token } = await register(h, "Ann");
    const e = await create(token, { kind: "mixed", seed: 3 });
    expect(e.status).toBe(200);
    const id = e.body.episode_id;
    expect(e.body.kind).toBeUndefined();                                   // mixed: kind hidden
    expect((await h.http().get(`/episodes/${id}/bars`).set(auth(token))).body.bars).toHaveLength(60);
    expect((await h.http().post(`/episodes/${id}/advance`).set(auth(token)).send({ n: 5 })).body.day).toBe(65);
    expect((await h.http().post(`/episodes/${id}/predictions`).set(auth(token)).send({ horizon: 5, p_up: 0.7 })).status).toBe(200);
    expect((await h.http().get(`/episodes/${id}/predictions`).set(auth(token))).status).toBe(200);
    expect((await h.http().get(`/episodes/${id}/score`).set(auth(token))).body.enough).toBe(false);
    const list = await h.http().get("/episodes").set(auth(token));
    expect(list.body).toHaveLength(1);
    const rev = await h.http().post(`/episodes/${id}/reveal`).set(auth(token));
    expect(rev.body.identity.symbol).toBe("AAPL");                         // identity passes only through the reveal
    expect((await h.http().get(`/episodes/${id}`).set(auth(token))).body.kind).toBe("synthetic"); // kind visible after reveal
  });

  it("learner isolation fuzz: 100 cross-access attempts all get 404 or 401 and cause zero Python calls", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const ea = (await create(a.token)).body.episode_id;
    const eb = (await create(b.token)).body.episode_id;
    h.fake.calls.length = 0;
    const routes: Array<[string, (id: string) => string, object?]> = [
      ["get", (id) => `/episodes/${id}`], ["get", (id) => `/episodes/${id}/bars`], ["post", (id) => `/episodes/${id}/advance`, { n: 1 }],
      ["post", (id) => `/episodes/${id}/predictions`, { horizon: 1, p_up: 0.5 }], ["get", (id) => `/episodes/${id}/predictions`],
      ["get", (id) => `/episodes/${id}/score`], ["post", (id) => `/episodes/${id}/reveal`],
    ];
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 100; i++) {
      const [method, path, body] = routes[Math.floor(rnd() * routes.length)];
      const attackerIsA = rnd() < 0.5;
      const target = attackerIsA ? eb : ea; // someone else's episode
      const unknown = rnd() < 0.2 ? "zzzzzzzz" : target;
      const token = attackerIsA ? a.token : b.token;
      const req = (h.http() as any)[method](path(unknown)).set(auth(token));
      const r = body ? await req.send(body) : await req;
      expect(r.status).toBe(404);
      expect(r.body.message).toBe("That episode was not found.");          // same body as an unknown id
      const noToken = await (h.http() as any)[method](path(target));
      expect(noToken.status).toBe(401);
    }
    expect(h.fake.calls).toEqual([]);                                       // zero upstream calls for refused requests
    expect((await h.http().get(`/episodes/${ea}`).set(auth(a.token))).status).toBe(200);
    expect((await h.http().get(`/episodes/${eb}`).set(auth(b.token))).status).toBe(200);
  });

  it("invalid input is refused with 422 before any call to Python", async () => {
    const { token } = await register(h, "Cy");
    const id = (await create(token)).body.episode_id;
    h.fake.calls.length = 0;
    const bad: Array<[string, string, object]> = [
      ["post", "/episodes", { kind: "weird" }], ["post", "/episodes", { n_bars: 10 }], ["post", "/episodes", { n_bars: 501 }],
      ["post", "/episodes", { initial_visible: 19 }], ["post", "/episodes", { extra: 1 }],
      ["post", `/episodes/${id}/advance`, { n: 0 }], ["post", `/episodes/${id}/advance`, { n: 21 }],
      ["post", `/episodes/${id}/predictions`, { horizon: 3, p_up: 0.5 }], ["post", `/episodes/${id}/predictions`, { horizon: 5, p_up: 1 }],
      ["post", `/episodes/${id}/predictions`, { horizon: 5, p_up: 0.005 }], ["post", `/episodes/${id}/predictions`, { horizon: 5, p_up: 0.12345 }],
      ["post", `/episodes/${id}/predictions`, { horizon: 5, p_up: 0.5, hack: true }],
    ];
    for (const [m, p, body] of bad) {
      const r = await (h.http() as any)[m](p).set(auth(token)).send(body);
      expect(r.status, `${p} ${JSON.stringify(body)}`).toBe(422);
    }
    expect(h.fake.calls).toEqual([]);
  });

  it("whitelisting: leaked upstream fields never reach the learner before the reveal", async () => {
    const { token } = await register(h, "Dee");
    h.fake.leak = true;
    const e = await create(token, { kind: "mixed" });
    const id = e.body.episode_id;
    const bodies = [e.body, (await h.http().get(`/episodes/${id}`).set(auth(token))).body, (await h.http().get(`/episodes/${id}/bars`).set(auth(token))).body,
      (await h.http().post(`/episodes/${id}/advance`).set(auth(token)).send({ n: 2 })).body, (await h.http().get("/episodes").set(auth(token))).body];
    for (const b of bodies) expect(JSON.stringify(b)).not.toMatch(IDENTITY);
    expect(e.body.kind).toBeUndefined();                                    // even a leaked kind of an open mixed episode is dropped
    const rev = await h.http().post(`/episodes/${id}/reveal`).set(auth(token));
    expect(JSON.stringify(rev.body)).toMatch(/AAPL/);                       // after the reveal the identity block appears
  });

  it("upstream failures become safe messages", async () => {
    const { token } = await register(h, "Eve");
    const id = (await create(token)).body.episode_id;
    for (const [status, expected] of [[504, 504], [502, 502], [409, 409]] as const) {
      h.fake.failWith = status;
      const r = await h.http().get(`/episodes/${id}/bars`).set(auth(token));
      expect(r.status).toBe(expected);
      expect(JSON.stringify(r.body)).not.toMatch(/127\.0\.0\.1|token|upstream/i);
    }
  });

  it("progress counts only the learner's own episodes", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    await create(a.token); await create(a.token); await create(b.token);
    expect((await h.http().get("/me/progress").set(auth(a.token))).body.episodes).toBe(2);
    expect((await h.http().get("/me/progress").set(auth(b.token))).body.episodes).toBe(1);
    const none = await register(h, "Cat");
    const p = await h.http().get("/me/progress").set(auth(none.token));
    expect(p.body.episodes).toBe(0);
    expect(p.body.overall.enough).toBe(false);
  });

  it("trace: route patterns only, own entries only, at most 200 kept", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const id = (await create(a.token)).body.episode_id;
    await h.http().get(`/episodes/${id}/bars?secret=1`).set(auth(a.token));
    await h.http().get(`/episodes/${id}`).set(auth(b.token));                // refused: not b's
    const ta = (await h.http().get("/trace").set(auth(a.token))).body;
    const tb = (await h.http().get("/trace").set(auth(b.token))).body;
    const text = JSON.stringify(ta);
    expect(text).not.toContain(id);
    expect(text).not.toContain("secret=1");
    expect(text).not.toMatch(/Bearer|eyJ/);
    expect(ta.some((e: any) => e.route === "GET /episodes/:id/bars" && e.upstream.length === 1)).toBe(true);
    expect(tb.every((e: any) => e.status === 404 || e.route.includes("trace"))).toBe(true);
    expect(JSON.stringify(tb)).not.toContain("bars");
    for (let i = 0; i < 210; i++) await h.http().get("/me").set(auth(a.token));
    expect((await h.http().get("/trace?limit=500").set(auth(a.token))).body.length).toBeLessThanOrEqual(200);
  });

  it("system: statuses, versions and the ownership table", async () => {
    const { token } = await register(h, "Fay");
    const r = await h.http().get("/system").set(auth(token));
    expect(r.status).toBe(200);
    expect(r.body.health.gateway).toBe("ok");
    expect(r.body.health.database).toBe("ok");
    expect(r.body.app_migration).toMatch(/glossary-term/);
    expect(r.body.ownership.map((o: any) => `${o.schema}:${o.owner}`)).toEqual(expect.arrayContaining(["app:NestJS gateway", "research:Python service", "market:Python service"]));
    expect((await h.http().get("/system")).status).toBe(401);
  });
});
