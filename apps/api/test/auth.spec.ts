import { JwtService } from "@nestjs/jwt";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../src/auth/password";
import { auth, HAS_DB, Harness, register, resetAppTables, SECRETS, startApp, TEST_URL } from "./helpers";

describe.skipIf(!HAS_DB)("auth (database)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp(); });
  afterAll(async () => { await h.close(); });
  beforeEach(async () => { await resetAppTables(h.pool); });

  it("registers, logs in and identifies the learner without leaking password material", async () => {
    const reg = await h.http().post("/auth/register").send({ display_name: "Sam", password: "correct horse battery" });
    expect(reg.status).toBe(200);
    const login = await h.http().post("/auth/login").send({ display_name: "sam", password: "correct horse battery" });
    expect(login.status).toBe(200);
    const me = await h.http().get("/me").set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.display_name).toBe("Sam");
    expect(JSON.stringify(me.body)).not.toMatch(/password|scrypt|hash/i);
    const row = (await h.pool.query("SELECT password_hash FROM app.learner")).rows[0];
    expect(row.password_hash.startsWith("scrypt$131072$8$1$")).toBe(true);
  });

  it("uses a different salt for the same password", async () => {
    await register(h, "Ann", "same password twice");
    await register(h, "Bob", "same password twice");
    const rows = (await h.pool.query("SELECT password_hash FROM app.learner")).rows.map((r) => r.password_hash);
    expect(rows[0]).not.toEqual(rows[1]);
  });

  it("wrong password and unknown name look exactly the same", async () => {
    await register(h, "Cy");
    const wrong = await h.http().post("/auth/login").send({ display_name: "Cy", password: "not the right one" });
    const unknown = await h.http().post("/auth/login").send({ display_name: "Nobody", password: "not the right one" });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toEqual(unknown.body.message);
  });

  it("rejects names that differ only by case or spaces, and bad lengths", async () => {
    await register(h, "Dee");
    const dup = await h.http().post("/auth/register").send({ display_name: "  dEE ", password: "another long password" });
    expect(dup.status).toBe(409);
    expect((await h.http().post("/auth/register").send({ display_name: "Eve", password: "123456789" })).status).toBe(422);
    expect((await h.http().post("/auth/register").send({ display_name: "Eve", password: "x".repeat(129) })).status).toBe(422);
    expect((await h.http().post("/auth/register").send({ display_name: "E", password: "long enough password" })).status).toBe(422);
    const msg = (await h.http().post("/auth/register").send({ display_name: "Eve", password: "short" })).body.message;
    expect(msg).toMatch(/at least 10 characters/);
  });

  it("the guard refuses missing, malformed, foreign-secret and expired tokens", async () => {
    const { id } = await register(h, "Fay");
    const other = new JwtService({ secret: "some-other-secret-value-1234567890" });
    const expired = await new JwtService({ secret: SECRETS.jwt }).signAsync({ sub: id }, { expiresIn: -10 });
    for (const header of [undefined, "Bearer garbage", `Bearer ${await other.signAsync({ sub: id })}`, `Bearer ${expired}`, "Basic abc"]) {
      const r = header ? await h.http().get("/me").set("Authorization", header) : await h.http().get("/me");
      expect(r.status).toBe(401);
    }
  });

  it("limits login attempts: the 6th in a minute from one client and name gets 429", async () => {
    const limited = await startApp({ loginLimit: 5 });
    try {
      let last = 0;
      for (let i = 0; i < 6; i++) last = (await limited.http().post("/auth/login").send({ display_name: "Gus", password: "whatever password" })).status;
      expect(last).toBe(429);
    } finally { await limited.close(); }
  });

  it("never logs or returns passwords, hashes or tokens (except the token in the login reply)", async () => {
    const pw = "Sup3r-Secret-Pw-123";
    const logs: string[] = [];
    const spies = (["log", "warn", "error", "debug"] as const).map((m) => vi.spyOn(process.stdout, "write").mockImplementation((c: any) => { logs.push(String(c)); return true; }));
    const reg = await h.http().post("/auth/register").send({ display_name: "Hal", password: pw });
    const login = await h.http().post("/auth/login").send({ display_name: "Hal", password: pw });
    const me = await h.http().get("/me").set(auth(login.body.token));
    const bad = await h.http().post("/auth/login").send({ display_name: "Hal", password: pw + "x" });
    spies.forEach((s) => s.mockRestore());
    const hash = (await h.pool.query("SELECT password_hash FROM app.learner")).rows[0].password_hash;
    for (const body of [JSON.stringify(me.body), JSON.stringify(bad.body), JSON.stringify(reg.body).replace(reg.body.token, "")]) {
      expect(body).not.toContain(pw);
      expect(body).not.toContain(hash);
    }
    const all = logs.join("\n");
    expect(all).not.toContain(pw);
    expect(all).not.toContain(hash);
    expect(all).not.toContain(login.body.token);
  });
});

describe("password hashing", () => {
  it("verifies, rejects and takes a measurable time", async () => {
    const t0 = performance.now();
    const stored = await hashPassword("a long enough password");
    const ms = performance.now() - t0;
    console.log(`scrypt hash time on this machine: ${ms.toFixed(0)} ms`);
    expect(ms).toBeGreaterThan(50);
    expect(ms).toBeLessThan(2000);
    expect(await verifyPassword("a long enough password", stored)).toBe(true);
    expect(await verifyPassword("a long enough passwore", stored)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});

describe.skipIf(!HAS_DB)("migrations (database)", () => {
  const cwd = path.resolve(__dirname, "..");
  const cli = path.resolve(cwd, "node_modules/node-pg-migrate/bin/node-pg-migrate.js");
  const run = (dir: "up" | "down", extra: string[] = []) =>
    spawnSync(process.execPath, [cli, dir, ...extra, "-m", "migrations", "--migrations-schema", "app", "--migrations-table", "pgmigrations", "--database-url-var", "DATABASE_URL"],
      { cwd, env: { ...process.env, DATABASE_URL: TEST_URL! }, encoding: "utf8" });

  async function tables(): Promise<Record<string, string[]>> {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: TEST_URL });
    try {
      const r = await pool.query("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('app','market','research') ORDER BY 1, 2");
      const out: Record<string, string[]> = { app: [], market: [], research: [] };
      for (const row of r.rows) out[row.table_schema].push(row.table_name);
      return out;
    } finally { await pool.end(); }
  }

  it("up, down (all), up leaves the same tables; Python tables are untouched; running up twice changes nothing", async () => {
    const before = await tables();
    expect(before.app).toEqual(expect.arrayContaining(["learner", "learner_episode", "learner_study", "glossary_term", "lesson", "lesson_question", "lesson_progress", "quiz_answer", "lesson_completion", "rate_event", "request_log", "pgmigrations"]));
    expect(run("up").status).toBe(0); // idempotent
    expect(await tables()).toEqual(before);
    expect(run("down", ["6"]).status).toBe(0);
    const down = await tables();
    expect(down.app).toEqual(["pgmigrations"]);          // the schema stays; it holds the version table
    expect(down.market).toEqual(before.market);
    expect(down.research).toEqual(before.research);
    expect(run("up").status).toBe(0);
    expect(await tables()).toEqual(before);
  });

  it("Python source never writes app tables (structural)", () => {
    const src = path.resolve(cwd, "../../services/market-data/src/market_data");
    const bad: string[] = [];
    const walk = (d: string) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) { if (f.name !== "__pycache__") walk(p); } else if (f.name.endsWith(".py") && /(INSERT\s+INTO|UPDATE|DELETE\s+FROM|TRUNCATE)\s+app\./i.test(fs.readFileSync(p, "utf8"))) bad.push(p); } };
    walk(src);
    expect(bad).toEqual([]);
  });
});
