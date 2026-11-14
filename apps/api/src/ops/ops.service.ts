import { Inject, Injectable, Logger } from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import { pick, Spec } from "../common/pick";
import { APP_CONFIG, AppConfig } from "../config/app-config";
import { DbService } from "../db/db.service";
import { PythonClient } from "../python/python-client";

const METRICS_PYTHON: Spec = {
  service: true, uptime_seconds: true, note: true,
  routes: [{ route: true, count: true, client_errors: true, server_errors: true, p50_ms: true, p95_ms: true, max_ms: true }],
};
const DATA_STATUS: Spec = {
  sources: [{ source: true, symbols: true, symbols_with_long_history: true, bars: true, first_date: true, last_date: true, retrieved_at: true }],
  min_sessions_for_long_history: true,
  quality: { run: true, rules_flagged: true, errors: true, warnings: true, infos: true },
  macro: { series: true, observations: true, first_date: true, last_date: true },
  caveats: [true], empty: true,
};

export const STATUS_CACHE_MS = 60_000;

@Injectable()
export class OpsService {
  private readonly log = new Logger("Ops");
  private cached: { at: number; value: any } | null = null;

  constructor(private readonly db: DbService, private readonly py: PythonClient, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  /** A learner token never opens /metrics. Only the separate operator token does; unset means closed. */
  operatorAllowed(header: string | undefined): boolean {
    const expected = this.cfg.operatorToken;
    if (!expected || !header) return false;
    const a = Buffer.from(header), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async gatewayRoutes(hours: number) {
    const r = await this.db.query(
      `SELECT route, count(*)::int AS count,
              count(*) FILTER (WHERE status BETWEEN 400 AND 499)::int AS client_errors,
              count(*) FILTER (WHERE status >= 500)::int AS server_errors,
              round((percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms))::numeric, 3)::float8 AS p50_ms,
              round((percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms))::numeric, 3)::float8 AS p95_ms,
              max(duration_ms)::float8 AS max_ms
         FROM app.request_log WHERE at > now() - make_interval(hours => $1)
        GROUP BY route ORDER BY count DESC, route`,
      [hours],
    );
    return r.rows;
  }

  async metrics(hours: number) {
    const gateway = { service: "gateway", note: "Learner requests in the window, from the durable request log. Counts are per route pattern.", routes: await this.gatewayRoutes(hours) };
    let python: any;
    try {
      python = pick<any>(await this.py.metrics(), METRICS_PYTHON).value;
    } catch {
      this.log.warn("python metrics unavailable");
    }
    return { window_hours: hours, gateway, ...(python ? { python } : {}) };
  }

  async dataStatus() {
    const now = Date.now();
    if (this.cached && now - this.cached.at < STATUS_CACHE_MS) return this.cached.value;
    const out = pick<any>(await this.py.dataStatus(), DATA_STATUS);
    if (out.dropped.length) this.log.warn(`dropped unexpected upstream fields in data status: ${out.dropped.join(", ")}`);
    this.cached = { at: now, value: out.value };
    return out.value;
  }

  clearCache(): void {
    this.cached = null;
  }
}
