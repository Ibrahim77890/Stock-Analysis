import { INestApplication } from "@nestjs/common";
import { Pool } from "pg";
import request from "supertest";
import { buildApp } from "../src/bootstrap";
import { AppConfig } from "../src/config/app-config";
import { PythonClient, UpstreamError } from "../src/python/python-client";
import { TraceService } from "../src/trace/trace.service";

export const TEST_URL = process.env.TEST_DATABASE_URL;
export const HAS_DB = Boolean(TEST_URL);
export const SECRETS = { jwt: "test-jwt-secret-0123456789abcdef", internal: "test-internal-token-abcdef0123456789" };

export function makeCfg(over: Partial<AppConfig> = {}): AppConfig {
  return {
    port: 0, databaseUrl: TEST_URL ?? "postgresql://u:p@127.0.0.1:5432/none", pythonApiUrl: "http://127.0.0.1:1",
    internalToken: SECRETS.internal, jwtSecret: SECRETS.jwt, corsOrigins: ["http://127.0.0.1:5173", "http://localhost:5173"],
    loginLimit: 50, ...over,
  };
}

/** In-memory stand-in for the Python service. Records every call; `leak` adds identity fields to replies. */
export interface FakePython {
  calls: string[];
  leak: boolean;
  failWith?: number;
  [k: string]: any;
}

export function makeFakePython(trace?: TraceService): FakePython {
  const episodes = new Map<string, { day: number; n_bars: number; kind_requested: string; status: string }>();
  let n = 0;
  const fake: FakePython = {
    calls: [], leak: false,
    async health() { return true; },
  };
  const rec = (name: string) => {
    fake.calls.push(name);
    trace?.addUpstream({ service: "python", route: `${name}`, status: 200, duration_ms: 1 });
    if (fake.failWith) throw new UpstreamError(fake.failWith, "The number service had a problem.");
  };
  const state = (id: string) => {
    const e = episodes.get(id)!;
    const s: any = { episode_id: id, n_bars: e.n_bars, initial_visible: 60, day: e.day, status: e.status, kind_requested: e.kind_requested };
    if (e.kind_requested !== "mixed" || e.status === "revealed") s.kind = "synthetic";
    if (fake.leak) Object.assign(s, { symbol: "AAPL", start_date: "2015-03-02", name: "Apple Inc." });
    if (fake.leak && e.kind_requested === "mixed") s.kind = "real"; // a leaked kind of an open mixed episode
    return s;
  };
  const has = (id: string) => { if (!episodes.has(id)) throw new UpstreamError(404, "That episode was not found."); };
  Object.assign(fake, {
    async createEpisode(b: any) { rec("createEpisode"); const id = `ep${++n}`; episodes.set(id, { day: b.initial_visible, n_bars: b.n_bars, kind_requested: b.kind, status: "open" }); return state(id); },
    async states(ids: string[]) { rec("states"); return { episodes: ids.filter((i) => episodes.has(i)).map((i) => state(i)) }; },
    async getEpisode(id: string) { rec("getEpisode"); has(id); return state(id); },
    async bars(id: string) { rec("bars"); has(id); const e = episodes.get(id)!; return { episode_id: id, bars: Array.from({ length: e.day }, (_, i) => ({ day: i + 1, open: 100, high: 101, low: 99, close: 100 + i * 0.1, rel_volume: 1, ...(fake.leak ? { symbol: "AAPL", date: "2015-03-02" } : {}) })) }; },
    async advance(id: string, k: number) { rec("advance"); has(id); const e = episodes.get(id)!; e.day = Math.min(e.n_bars, e.day + k); return state(id); },
    async addPrediction(id: string, horizon: number, p: number) { rec("addPrediction"); has(id); return { prediction_id: 1, day: episodes.get(id)!.day, horizon, p_up: p, status: "pending", outcome: null, created: true }; },
    async predictions(id: string) { rec("predictions"); has(id); return { episode_id: id, predictions: [], counts: { resolved: 0, void: 0, pending: 0, total: 0 } }; },
    async score(id: string) { rec("score"); has(id); return { episode_id: id, counts: { resolved: 0, void: 0, pending: 0, total: 0 }, n: 0, brier: null, skill_vs_coin_flip: null, log_loss: null, bins: [], murphy: {}, baselines: { coin_flip: 0.25 }, luck: { real_brier: null, luck_probability: null, n_perm: 5000, seed: 1, count: 0, not_reported: true, shuffled_quantiles: null }, enough: false, min_enough: 30, warnings: ["too few"] }; },
    async reveal(id: string) { rec("reveal"); has(id); episodes.get(id)!.status = "revealed"; return { episode_id: id, kind: "real", seed: 5, counts: { resolved: 0, void: 0, pending: 0, total: 0 }, identity: { symbol: "AAPL", name: "Apple Inc.", asset_type: "stock", sector: "Tech", first_date: "2015-03-02", last_date: "2016-03-01", source: "tiingo" }, data_trail: { provider: "tiingo", retrieved_at: null, feed_caveat: "x", universe_caveat: "y", adjustment: "z", stored_adjustment: "raw", file_hash_matches: true, warnings: [], licence: "internal use only" } }; },
    async summary(ids: string[]) { rec("summary"); return { overall: { n: ids.length, brier: null, skill_vs_coin_flip: null, log_loss: null, enough: false, min_enough: 30, warnings: [], baselines: { coin_flip: 0.25 }, luck: { real_brier: null, luck_probability: null, n_perm: 5000, seed: 1, count: 0, not_reported: true, shuffled_quantiles: null } }, by_kind: { real: { n: 0, brier: null }, synthetic: { n: 0, brier: null } }, by_horizon: { "1": { n: 0, brier: null }, "5": { n: 0, brier: null }, "10": { n: 0, brier: null } } }; },
  });
  return fake;
}

export interface Harness {
  app: INestApplication;
  fake: FakePython;
  cfg: AppConfig;
  pool: Pool;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function startApp(over: Partial<AppConfig> = {}): Promise<Harness> {
  const cfg = makeCfg(over);
  const holder: { fake?: FakePython } = {};
  const app = await buildApp(cfg, (builder: any) =>
    builder.overrideProvider(PythonClient).useFactory({ factory: (trace: TraceService) => (holder.fake = makeFakePython(trace)), inject: [TraceService] }),
  );
  await app.init();
  const pool = new Pool({ connectionString: cfg.databaseUrl, max: 2 });
  return { app, fake: holder.fake!, cfg, pool, http: () => request(app.getHttpServer()), close: async () => { await pool.end(); await app.close(); } };
}

export async function resetAppTables(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE app.learner CASCADE");
}

export async function register(h: Harness, name: string, password = "correct horse battery"): Promise<{ token: string; id: string }> {
  const r = await h.http().post("/auth/register").send({ display_name: name, password });
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.learner.learner_id };
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
