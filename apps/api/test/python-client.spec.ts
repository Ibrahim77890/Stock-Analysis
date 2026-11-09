import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, ConfigError, redact } from "../src/config/app-config";
import { PythonClient, UpstreamError } from "../src/python/python-client";
import { TraceService } from "../src/trace/trace.service";
import { makeCfg, SECRETS } from "./helpers";
import { pick } from "../src/common/pick";

afterEach(() => vi.unstubAllGlobals());

const client = () => new PythonClient(makeCfg({ pythonApiUrl: "http://python.internal:8000" }), new TraceService());
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PythonClient", () => {
  it("sends the internal token header and parses JSON", async () => {
    const f = vi.fn().mockResolvedValue(reply(200, { episode_id: "a" }));
    vi.stubGlobal("fetch", f);
    expect(await client().getEpisode("a")).toEqual({ episode_id: "a" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("http://python.internal:8000/episodes/a");
    expect(init.headers["x-internal-token"]).toBe(SECRETS.internal);
  });

  it("a timeout becomes 504 and a connection failure 502, with safe messages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    await expect(client().bars("a")).rejects.toMatchObject({ status: 504 });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:8000")));
    const err = await client().bars("a").catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(err.getStatus()).toBe(502);
    expect(JSON.stringify(err.getResponse())).not.toMatch(/ECONNREFUSED|127\.0\.0\.1|python\.internal|token/i);
  });

  it("an upstream 500 becomes 502 without the upstream body; a 404 stays 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(500, { detail: "Traceback at /srv/secret.py with token abc" })));
    const e500 = await client().score("a").catch((e) => e);
    expect(e500.getStatus()).toBe(502);
    expect(JSON.stringify(e500.getResponse())).not.toMatch(/Traceback|secret|abc/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(404, { detail: "unknown episode" })));
    const e404 = await client().getEpisode("a").catch((e) => e);
    expect(e404.getStatus()).toBe(404);
    expect(e404.getResponse().message).toBe("That episode was not found.");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(409, {})));
    expect((await client().advance("a", 1).catch((e) => e)).getStatus()).toBe(409);
  });

  it("health() never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect(await client().health()).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(200)));
    expect(await client().health()).toBe(true);
  });
});

describe("configuration", () => {
  const good = { DATABASE_URL: "postgresql://u:pw-secret-123@h/db", INTERNAL_API_TOKEN: "tok-abcdef-123456", JWT_SECRET: "jwt-abcdef-123456" };

  it.each(["DATABASE_URL", "INTERNAL_API_TOKEN", "JWT_SECRET"])("a missing %s is reported by name and never by value", (name) => {
    const env: any = { ...good };
    delete env[name];
    let message = "";
    try { loadConfig(env); } catch (e) { expect(e).toBeInstanceOf(ConfigError); message = (e as Error).message; }
    expect(message).toContain(name);
    for (const v of Object.values(good)) expect(message).not.toContain(v);
  });

  it("refuses a wildcard origin and has loopback defaults", () => {
    expect(() => loadConfig({ ...good, CORS_ORIGINS: "*" })).toThrow(ConfigError);
    const cfg = loadConfig(good);
    expect(cfg.corsOrigins).toEqual(["http://127.0.0.1:5173", "http://localhost:5173"]);
    expect(cfg.pythonApiUrl).toBe("http://127.0.0.1:8000");
  });

  it("redact removes every secret, longest first", () => {
    const cfg = loadConfig(good);
    const text = `url=${good.DATABASE_URL} t=${good.INTERNAL_API_TOKEN} j=${good.JWT_SECRET} pw=pw-secret-123`;
    const out = redact(text, cfg);
    for (const s of ["tok-abcdef-123456", "jwt-abcdef-123456", "pw-secret-123"]) expect(out).not.toContain(s);
  });
});

describe("pick (whitelisting)", () => {
  it("keeps listed fields, drops the rest and reports names only", () => {
    const r = pick({ day: 1, symbol: "AAPL", nested: { a: 1, secret: 2 }, list: [{ x: 1, y: 2 }] }, { day: true, nested: { a: true }, list: [{ x: true }] });
    expect(r.value).toEqual({ day: 1, nested: { a: 1 }, list: [{ x: 1 }] });
    expect(r.dropped.sort()).toEqual(["list[].y", "nested.secret", "symbol"]);
    expect(JSON.stringify(r.dropped)).not.toContain("AAPL");
  });
});
