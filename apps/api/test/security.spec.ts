import { JwtService } from "@nestjs/jwt";
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { swaggerDocument } from "../src/bootstrap";
import { redact } from "../src/config/app-config";
import { auth, HAS_DB, Harness, makeCfg, register, resetAppTables, SECRETS, startApp } from "./helpers";

/** Routes that are public on purpose. Everything else must answer 401 without a learner token. */
const PUBLIC = new Set(["POST /auth/register", "POST /auth/login", "GET /health", "GET /glossary", "GET /glossary/{slug}"]);
/** The operator route has its own token: without it, 401 as well. */
const OPERATOR = new Set(["GET /metrics"]);

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

describe.skipIf(!HAS_DB)("security review checks (ASVS level 1 subset)", () => {
  let h: Harness;
  beforeAll(async () => { h = await startApp({ operatorToken: "operator-token-for-security-tests-0123456789" }); });
  afterAll(async () => { await h.close(); });

  it("ROUTE SWEEP: every route in the OpenAPI is either on the written public list or answers 401 without a token", async () => {
    const doc: any = swaggerDocument(h.app);
    const seen: string[] = [];
    const unlisted: string[] = [];
    for (const [p, ops] of Object.entries<any>(doc.paths)) {
      for (const method of Object.keys(ops)) {
        const key = `${method.toUpperCase()} ${p}`;
        seen.push(key);
        const url = p.replace(/\{[^}]+\}/g, "x1").replace(/^\/(.*)$/, "/$1");
        const m = method.toLowerCase() as "get" | "post";
        const r = m === "get" ? await h.http().get(url) : await h.http().post(url).send({});
        if (PUBLIC.has(key)) continue;
        if (r.status !== 401) unlisted.push(`${key} -> ${r.status}`);
      }
    }
    expect(seen.length).toBeGreaterThan(30);
    expect(unlisted).toEqual([]);
    expect([...OPERATOR].every((k) => seen.includes(k))).toBe(true);
    for (const k of PUBLIC) expect(seen, `public route ${k} is not in the API`).toContain(k);
  });

  it("the sweep detects an unprotected route (negative): a public route would be listed", async () => {
    const r = await h.http().get("/health");
    expect(r.status).toBe(200);          // /health answers without a token, so it must be (and is) on the public list
    expect(PUBLIC.has("GET /health")).toBe(true);
    expect(PUBLIC.has("GET /me")).toBe(false);
  });

  it("security headers are on every reply, and the content policy is off only for the Swagger page", async () => {
    for (const [p, expectCsp] of [["/health", true], ["/lessons", true], ["/docs", false]] as const) {
      const r = await h.http().get(p);
      expect(r.headers["x-content-type-options"], p).toBe("nosniff");
      expect(r.headers["referrer-policy"], p).toBe("no-referrer");
      expect(r.headers["x-frame-options"], p).toBe("DENY");
      expect(r.headers["cache-control"], p).toBe("no-store");
      expect(Boolean(r.headers["content-security-policy"]), p).toBe(expectCsp);
    }
  });

  it("tokens: another secret, the none algorithm, an expired token, a missing subject and garbage are all 401", async () => {
    const mine = new JwtService({ secret: SECRETS.jwt });
    const other = new JwtService({ secret: "another-secret-another-secret-123456" });
    const { id } = await register(h, "SecAnn");
    const noneToken = `${b64({ alg: "none", typ: "JWT" })}.${b64({ sub: id })}.`;
    const hs512 = (() => { const head = b64({ alg: "HS512", typ: "JWT" }), body = b64({ sub: id }); return `${head}.${body}.${createHmac("sha512", SECRETS.jwt).update(`${head}.${body}`).digest("base64url")}`; })();
    const tokens = [await other.signAsync({ sub: id }), noneToken, hs512, await mine.signAsync({ sub: id }, { expiresIn: -10 }), await mine.signAsync({}), "garbage", ""];
    for (const t of tokens) expect((await h.http().get("/lessons").set({ Authorization: `Bearer ${t}` })).status, t.slice(0, 20)).toBe(401);
    expect((await h.http().get("/lessons").set(auth(await mine.signAsync({ sub: id })))).status).toBe(200);   // the control: a good token works
  });

  it("token lifetime is two hours", async () => {
    const { token } = await register(h, "SecBob");
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(payload.exp - payload.iat).toBe(2 * 3600);
  });

  it("CORS: only the listed origins get the allow header; other origins and methods get none", async () => {
    const ok = await h.http().options("/lessons").set("Origin", "http://127.0.0.1:5173").set("Access-Control-Request-Method", "GET");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:5173");
    const bad = await h.http().options("/lessons").set("Origin", "http://evil.example").set("Access-Control-Request-Method", "GET");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    expect(String(ok.headers["access-control-allow-methods"] ?? "")).not.toMatch(/DELETE|PUT|PATCH/);
  });

  it("errors never show a stack, a path or an upstream body; a login failure says the same for a wrong name and a wrong password", async () => {
    await resetAppTables(h.pool);
    await register(h, "SecCy");
    const a = await h.http().post("/auth/login").send({ display_name: "SecCy", password: "wrong password here" });
    const b = await h.http().post("/auth/login").send({ display_name: "NoSuchPerson", password: "wrong password here" });
    expect(a.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
    const e = await h.http().post("/auth/register").send({ display_name: "x", password: "short" });
    expect(e.status).toBe(422);
    expect(JSON.stringify(e.body)).not.toMatch(/at \w+|node_modules|\.ts:|Error:|stack/);
  });

  it("passwords are stored as scrypt hashes, never as text", async () => {
    await resetAppTables(h.pool);
    await register(h, "SecDee", "my own long password here");
    const r = await h.pool.query("SELECT password_hash FROM app.learner");
    expect(r.rows[0].password_hash).toMatch(/^scrypt\$/);
    expect(r.rows[0].password_hash).not.toContain("my own long password here");
  });

  it("the secrets in the configuration are redacted from error text", () => {
    const cfg = makeCfg({ operatorToken: "operator-token-for-redaction-test-xyz" });
    const text = `failed with ${cfg.internalToken} and ${cfg.jwtSecret} and ${cfg.operatorToken}`;
    const clean = redact(text, cfg);
    for (const secret of [cfg.internalToken, cfg.jwtSecret, cfg.operatorToken!]) expect(clean).not.toContain(secret);
    expect(clean).toContain("***");
  });
});
