import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, HAS_DB, Harness, register, resetAppTables, startApp } from "./helpers";

const ISO = /\d{4}-\d{2}-\d{2}/g;
const VAULT_KEYS = /practice_end|vault_start|vault_total_return/;
const RUN = { fast: 10, slow: 40, cost_bps: 2, seed: 1, n_paths: 10 };

describe.skipIf(!HAS_DB)("lab gateway (database, fake Python)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp({ labRunsPerMinute: 5 }); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => {
    await resetAppTables(h.pool);
    h.fake.calls.length = 0; h.fake.leak = false; h.fake.labLeak = false; h.fake.failWith = undefined;
  });

  const newStudy = async (token: string, body: object = { symbol: "TESTX" }) => h.http().post("/lab/studies").set(auth(token)).send(body);
  const run = (token: string, id: number | string, body: object = RUN) => h.http().post(`/lab/studies/${id}/runs`).set(auth(token)).send(body);

  it("a learner starts a study, tries rules, repeats one, opens the vault once and reads it again", async () => {
    const { token } = await register(h, "Ann");
    expect((await h.http().get("/lab/stocks").set(auth(token))).body.stocks[0].symbol).toBe("TESTX");
    const s = await newStudy(token, { symbol: "testx" });
    expect(s.status).toBe(200);
    const id = s.body.study_id;
    expect(s.body.vault_open).toBe(false);
    const a = await run(token, id), b = await run(token, id, { ...RUN, fast: 5, slow: 25 }), c = await run(token, id);
    expect([a.body.counted, b.body.counted, c.body.counted]).toEqual([true, true, false]);
    expect(c.body.trial_count).toBe(2);
    expect("overfitting_meter" in a.body).toBe(false); // absent (not null) with one idea
    expect(b.body.overfitting_meter.trials).toBe(2);
    expect((await h.http().get(`/lab/studies/${id}`).set(auth(token))).body.ideas_tried).toBe(2);
    expect((await h.http().get("/lab/studies").set(auth(token))).body).toHaveLength(1);
    const v = await h.http().post(`/lab/studies/${id}/vault`).set(auth(token)).send({ fast: 10, slow: 40, cost_bps: 2, confirm: true });
    expect(v.status).toBe(200);
    expect(v.body.rule.total_return).toBe(0.1);
    const again = await h.http().post(`/lab/studies/${id}/vault`).set(auth(token)).send({ fast: 10, slow: 40, cost_bps: 2, confirm: true });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/already opened/);
    expect((await h.http().get(`/lab/studies/${id}/vault`).set(auth(token))).body.params.fast).toBe(10);
  });

  it("study isolation fuzz: 100 cross-access attempts all get the same 404 and cause zero Python calls", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const sa = (await newStudy(a.token)).body.study_id, sb = (await newStudy(b.token)).body.study_id;
    h.fake.calls.length = 0;
    const routes: Array<[string, (id: string) => string, object?]> = [
      ["get", (id) => `/lab/studies/${id}`], ["post", (id) => `/lab/studies/${id}/runs`, RUN],
      ["post", (id) => `/lab/studies/${id}/vault`, { fast: 10, slow: 40, cost_bps: 2, confirm: true }], ["get", (id) => `/lab/studies/${id}/vault`],
    ];
    let seed = 11;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let first: string | undefined;
    for (let i = 0; i < 100; i++) {
      const [method, path, body] = routes[Math.floor(rnd() * routes.length)];
      const attackerIsA = rnd() < 0.5;
      const target = String(attackerIsA ? sb : sa);
      const id = rnd() < 0.2 ? "999999" : rnd() < 0.1 ? "abc" : target;
      const req = (h.http() as any)[method](path(id)).set(auth(attackerIsA ? a.token : b.token));
      const r = body ? await req.send(body) : await req;
      expect(r.status).toBe(404);
      first ??= JSON.stringify({ ...r.body, request_id: undefined });
      expect(JSON.stringify({ ...r.body, request_id: undefined })).toBe(first); // identical bodies
      expect((await (h.http() as any)[method](path(target))).status).toBe(401);
    }
    expect(h.fake.calls).toEqual([]);
    expect((await h.http().get(`/lab/studies/${sa}`).set(auth(a.token))).status).toBe(200);
    expect((await h.http().get(`/lab/studies/${sb}`).set(auth(b.token))).status).toBe(200);
  });

  it.each([
    ["fast equals slow", { ...RUN, fast: 40 }],
    ["fast above slow", { ...RUN, fast: 50 }],
    ["fast of 1", { ...RUN, fast: 1 }],
    ["slow of 301", { ...RUN, slow: 301 }],
    ["cost of 51", { ...RUN, cost_bps: 51 }],
    ["negative cost", { ...RUN, cost_bps: -1 }],
    ["too many paths", { ...RUN, n_paths: 201 }],
    ["too few paths", { ...RUN, n_paths: 9 }],
    ["text for a number", { ...RUN, fast: "ten" }],
    ["decimal days", { ...RUN, slow: 40.5 }],
    ["an extra field", { ...RUN, practice_end: "2021-12-29" }],
  ])("refuses %s with 422 and no Python call", async (_name, body) => {
    const { token } = await register(h, "Ann");
    const id = (await newStudy(token)).body.study_id;
    h.fake.calls.length = 0;
    const r = await run(token, id, body as object);
    expect(r.status).toBe(422);
    expect(h.fake.calls).toEqual([]);
  });

  it("refuses a vault call without the confirmation, or with a wrong value, and sends nothing", async () => {
    const { token } = await register(h, "Ann");
    const id = (await newStudy(token)).body.study_id;
    await run(token, id);
    h.fake.calls.length = 0;
    for (const body of [{ fast: 10, slow: 40, cost_bps: 2 }, { fast: 10, slow: 40, cost_bps: 2, confirm: false }, { fast: 10, slow: 40, cost_bps: 2, confirm: "yes" }, { fast: 10, slow: 40, confirm: true }]) {
      expect((await h.http().post(`/lab/studies/${id}/vault`).set(auth(token)).send(body)).status).toBe(422);
    }
    expect(h.fake.calls).toEqual([]);
    expect((await h.http().get(`/lab/studies/${id}`).set(auth(token))).body.vault_open).toBe(false);
  });

  it("limits runs per minute per learner with Retry-After, and the vault to 3 tries a minute", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    const ia = (await newStudy(a.token)).body.study_id, ib = (await newStudy(b.token)).body.study_id;
    for (let i = 0; i < 5; i++) expect((await run(a.token, ia, { ...RUN, slow: 40 + i })).status).toBe(200);
    const sixth = await run(a.token, ia, { ...RUN, slow: 99 });
    expect(sixth.status).toBe(429);
    expect(Number(sixth.headers["retry-after"])).toBeGreaterThan(0);
    expect(sixth.body.message).toMatch(/wait \d+ seconds/);
    expect((await run(b.token, ib)).status).toBe(200); // another learner is not affected
    const bad = { fast: 10, slow: 41, cost_bps: 2, confirm: true };
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await h.http().post(`/lab/studies/${ia}/vault`).set(auth(a.token)).send(bad)).status);
    expect(codes.slice(0, 3)).not.toContain(429);
    expect(codes[3]).toBe(429);
  });

  it("a study cap: the 21st study is refused and nothing changes", async () => {
    const { token } = await register(h, "Ann");
    for (let i = 0; i < 20; i++) expect((await newStudy(token)).status).toBe(200);
    const r = await newStudy(token);
    expect(r.status).toBe(422);
    expect(r.body.message).toMatch(/at most 20/);
    expect((await h.http().get("/lab/studies").set(auth(token))).body).toHaveLength(20);
    const rows = await h.pool.query("SELECT count(*)::int n FROM app.learner_study");
    expect(rows.rows[0].n).toBe(20);
  });

  it("drops practice-end, vault-start and vault-number fields a faulty upstream adds before the vault is opened", async () => {
    const { token } = await register(h, "Ann");
    h.fake.labLeak = true;
    const s = await newStudy(token);
    const id = s.body.study_id;
    const replies = [s, await h.http().get("/lab/stocks").set(auth(token)), await run(token, id), await h.http().get(`/lab/studies/${id}`).set(auth(token)), await h.http().get("/lab/studies").set(auth(token))];
    for (const r of replies) {
      const text = JSON.stringify(r.body);
      expect(r.status).toBe(200);
      expect(text).not.toMatch(VAULT_KEYS);
      expect(text).not.toContain("2022-01-10");
    }
    const v = await h.http().post(`/lab/studies/${id}/vault`).set(auth(token)).send({ fast: 10, slow: 40, cost_bps: 2, confirm: true });
    expect(v.body.rule.total_return).toBe(0.1); // after the call the vault block appears
  });

  it("no date after the practice years appears in any reply before the vault is opened", async () => {
    const { token } = await register(h, "Ann");
    const id = (await newStudy(token)).body.study_id;
    const r = await run(token, id);
    const dates = JSON.stringify(r.body).match(ISO) ?? [];
    expect(dates.length).toBeGreaterThan(0);
    expect(dates.every((d) => d <= "2021-12-29")).toBe(true);
  });

  it("maps upstream failures to plain messages without URLs, tokens or the word upstream", async () => {
    const { token } = await register(h, "Ann");
    const id = (await newStudy(token)).body.study_id;
    for (const code of [502, 504]) {
      h.fake.failWith = code;
      const r = await run(token, id, { ...RUN, slow: 50 + code % 10 });
      expect(r.status).toBe(code);
      expect(JSON.stringify(r.body)).not.toMatch(/http|token|upstream|127\.0\.0\.1/i);
    }
  });

  it("study counts per learner match the table and a learner sees only their own list", async () => {
    const a = await register(h, "Ann"), b = await register(h, "Bob");
    await newStudy(a.token); await newStudy(a.token); await newStudy(b.token);
    expect((await h.http().get("/lab/studies").set(auth(a.token))).body).toHaveLength(2);
    expect((await h.http().get("/lab/studies").set(auth(b.token))).body).toHaveLength(1);
    const rows = await h.pool.query("SELECT learner_id, count(*)::int n FROM app.learner_study GROUP BY 1 ORDER BY 2");
    expect(rows.rows.map((r) => r.n)).toEqual([1, 2]);
  });

  it("requires sign-in for every Lab route", async () => {
    for (const [m, p] of [["get", "/lab/stocks"], ["post", "/lab/studies"], ["get", "/lab/studies"], ["get", "/lab/studies/1"], ["post", "/lab/studies/1/runs"], ["post", "/lab/studies/1/vault"], ["get", "/lab/studies/1/vault"]] as const) {
      expect(((await (h.http() as any)[m](p)) as any).status).toBe(401);
    }
  });
});
