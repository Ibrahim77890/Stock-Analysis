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
    loginLimit: 50, labRunsPerMinute: 20, ...over,
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
  // ---- Strategy Lab fake: studies, trial counting, one-use vault; `labLeak` adds fields that must never reach a learner
  const studies = new Map<number, { symbol: string; trials: string[]; vault: boolean }>();
  let sid = 100;
  const metrics = (r: number) => ({ total_return: r, cagr: 0.05, max_drawdown: -0.3, exposure: 0.6, trades: 25, sharpe: 0.7 });
  const growth = () => ({ dates: ["2005-01-03", "2021-12-29"], rule: [100, 180], buy_hold: [100, 250] });
  const hasStudy = (id: number) => { if (!studies.has(id)) throw new UpstreamError(404, "That study or stock was not found."); return studies.get(id)!; };
  const leakFields = () => (fake.labLeak ? { practice_end: "2021-12-29", vault_start: "2022-01-10", vault_total_return: 0.12 } : {});
  Object.assign(fake, {
    labLeak: false,
    async labStocks() { rec("labStocks"); return { stocks: [{ symbol: "TESTX", name: "Test stock", sector: null, first_date: "2005-01-03", bars: 5000, years: 19.8, ...leakFields() }] }; },
    async labCreate(b: any) { rec("labCreate"); const id = ++sid; studies.set(id, { symbol: b.symbol, trials: [], vault: false }); return { study_id: id, symbol: b.symbol, name: b.name ?? `Lab ${b.symbol}`, practice_bars: 4000, practice_years: 15.9, vault_bars: 1000, vault_years: 4, vault_open: false, ...leakFields() }; },
    async labInfo(ids: number[]) { rec("labInfo"); return { studies: ids.filter((i) => studies.has(i)).map((i) => { const s = studies.get(i)!; return { study_id: i, symbol: s.symbol, name: `Lab ${s.symbol}`, practice_years: 15.9, vault_years: 4, vault_open: s.vault, ideas_tried: s.trials.length, ...leakFields() }; }) }; },
    async labOverview(id: number) { rec("labOverview"); const s = hasStudy(id); return { study_id: id, symbol: s.symbol, name: `Lab ${s.symbol}`, practice_years: 15.9, practice_bars: 4000, vault_years: 4, vault_bars: 1000, vault_open: s.vault, ideas_tried: s.trials.length, trials: s.trials.map((t, i) => { const [f, sl, c] = t.split("/").map(Number); return { order: i + 1, fast: f, slow: sl, cost_bps: c, total_return: 1.2, sharpe: 0.8, trades: 25 }; }), ...leakFields() }; },
    async labRun(id: number, b: any) {
      rec("labRun"); const s = hasStudy(id); const key = `${b.fast}/${b.slow}/${b.cost_bps}`; const counted = !s.trials.includes(key); if (counted) s.trials.push(key);
      return { study_id: id, symbol: s.symbol, counted, trial_count: s.trials.length, params: { fast: b.fast, slow: b.slow, cost_bps: b.cost_bps, seed: b.seed, n_paths: b.n_paths }, practice_years: 15.9, practice_bars: 4000,
        rule: metrics(0.8), buy_hold: metrics(1.5), growth: growth(), yearly: [{ year: 2005, rule: 0.1, buy_hold: 0.2 }], costs: [{ cost_bps: 0, total_return: 0.9, sharpe: 0.8, trades: 25, buy_hold_total_return: 1.5 }],
        luck: { method: "block_bootstrap", n_paths: b.n_paths, seed: b.seed, real_total_return: 0.8, percentile_rank: 0.4, fraction_as_good: 0.6, median: 0.7, p5: 0.1, p95: 2, note: "n" },
        overfitting_meter: s.trials.length > 1 ? { trials: s.trials.length, best_sharpe: 1, expected_best_sharpe_by_luck: 0.02, dsr: 0.9, note: "n" } : null, warnings: [], config_hash: "abc", ...leakFields() };
    },
    async labVault(id: number, b: any) {
      rec("labVault"); const s = hasStudy(id); if (s.vault) throw new UpstreamError(409, "The vault of this study was already opened."); if (!s.trials.includes(`${b.fast}/${b.slow}/${b.cost_bps}`)) throw new UpstreamError(422, "Run this exact rule on the practice years first, then open the vault with it.");
      s.vault = true; return fake.labVaultBody(id, b);
    },
    labVaultBody(id: number, b: any) { const s = hasStudy(id); return { study_id: id, params: { fast: b.fast, slow: b.slow, cost_bps: b.cost_bps }, rule: metrics(0.1), buy_hold: metrics(0.5), growth: growth(), yearly: [{ year: 2022, rule: 0.1, buy_hold: 0.2 }], vault_years: 4, vault_bars: 1000, practice: { rule: metrics(1.2), buy_hold: metrics(2.5), years: 15.9 }, ideas_tried: s.trials.length }; },
    async labSavedVault(id: number) { rec("labSavedVault"); const s = hasStudy(id); if (!s.vault) throw new UpstreamError(422, "The vault of this study has not been opened yet."); const [f, sl, c] = s.trials[0].split("/").map(Number); return fake.labVaultBody(id, { fast: f, slow: sl, cost_bps: c }); },
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
  // A trace row may still be on its way from the last request of the previous test; if it collides with the
  // TRUNCATE the database reports a deadlock (40P01) and one retry is enough.
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query("TRUNCATE app.learner, app.rate_event CASCADE");
      return;
    } catch (e: any) {
      if (e?.code !== "40P01" || attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

export async function register(h: Harness, name: string, password = "correct horse battery"): Promise<{ token: string; id: string }> {
  const r = await h.http().post("/auth/register").send({ display_name: name, password });
  if (r.status !== 200) throw new Error(`register failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { token: r.body.token, id: r.body.learner.learner_id };
}

export const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
