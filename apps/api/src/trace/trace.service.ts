import { Injectable, NestMiddleware, Optional } from "@nestjs/common";
import { DbService } from "../db/db.service";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

export interface UpstreamEntry {
  service: "python";
  route: string; // pattern such as "POST /episodes/:id/advance": never a concrete id
  status: number;
  duration_ms: number;
}

export interface TraceEntry {
  request_id: string;
  time: string;
  method: string;
  route: string; // route pattern, never concrete ids or query values
  status: number;
  duration_ms: number;
  upstream: UpstreamEntry[];
}

interface Live {
  entry: TraceEntry;
  learnerId?: string;
}

const BUFFER = 200;

/** Where JSON request lines go. Tests replace it. One line per request: route PATTERN, status and time. Never a URL, query, body or header. */
export let requestLogSink: (line: string) => void = (line) => {
  if (process.env.REQUEST_LOG !== "off") process.stdout.write(line + "\n");
};
export function setRequestLogSink(fn: (line: string) => void): void {
  requestLogSink = fn;
}

@Injectable()
export class TraceService {
  private readonly als = new AsyncLocalStorage<Live>();
  private readonly byLearner = new Map<string, TraceEntry[]>(); // only used when there is no database (unit tests)
  private readonly pending = new Set<Promise<void>>();

  constructor(@Optional() private readonly db?: DbService) {}

  run<T>(live: Live, fn: () => T): T {
    return this.als.run(live, fn);
  }

  /** Called by the Python client for every upstream call. */
  addUpstream(e: UpstreamEntry): void {
    this.als.getStore()?.entry.upstream.push(e);
  }

  /** The id of the request being served (forwarded to Python so both logs carry it). */
  currentRequestId(): string | undefined {
    return this.als.getStore()?.entry.request_id;
  }

  setLearner(id: string): void {
    const s = this.als.getStore();
    if (s) s.learnerId = id;
  }

  finish(live: Live): void {
    if (!live.learnerId) return; // only logged-in learners are traced
    if (!this.db) return this.finishMemory(live);
    const learnerId = live.learnerId;
    const e = live.entry;
    const job: Promise<void> = this.db
      .query(
        `INSERT INTO app.request_log (request_id, learner_id, at, method, route, status, duration_ms, upstream)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [e.request_id, learnerId, e.time, e.method, e.route, e.status, e.duration_ms, JSON.stringify(e.upstream)],
      )
      .then(() =>
        this.db!.query(
          `DELETE FROM app.request_log WHERE learner_id = $1 AND id NOT IN
             (SELECT id FROM app.request_log WHERE learner_id = $1 ORDER BY at DESC, id DESC LIMIT ${BUFFER})`,
          [learnerId],
        ),
      )
      .then(() => undefined)
      .catch(() => undefined) // a failed trace write must never fail a request
      .finally(() => this.pending.delete(job));
    this.pending.add(job);
  }

  private finishMemory(live: Live): void {
    const list = this.byLearner.get(live.learnerId!) ?? [];
    list.push(live.entry);
    while (list.length > BUFFER) list.shift();
    this.byLearner.set(live.learnerId!, list);
  }

  /** Waits for writes that are still on their way (the reply is sent before the row is stored). */
  async flush(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  async last(learnerId: string, limit = 50): Promise<TraceEntry[]> {
    const n = Math.max(1, Math.min(Number.isFinite(limit) ? Math.floor(limit) : 50, BUFFER));
    if (!this.db) return (this.byLearner.get(learnerId) ?? []).slice(-n).reverse();
    await this.flush();
    const r = await this.db.query(
      `SELECT request_id, at, method, route, status, duration_ms, upstream FROM app.request_log
        WHERE learner_id = $1 ORDER BY at DESC, id DESC LIMIT $2`,
      [learnerId, n],
    );
    return r.rows.map((x) => ({
      request_id: x.request_id, time: new Date(x.at).toISOString(), method: x.method, route: x.route,
      status: x.status, duration_ms: x.duration_ms, upstream: x.upstream,
    }));
  }

  async size(learnerId: string): Promise<number> {
    if (!this.db) return this.byLearner.get(learnerId)?.length ?? 0;
    await this.flush();
    const r = await this.db.query("SELECT count(*)::int AS n FROM app.request_log WHERE learner_id = $1", [learnerId]);
    return r.rows[0].n;
  }
}

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private readonly trace: TraceService) {}

  use(req: any, res: any, next: () => void): void {
    const entry: TraceEntry = {
      request_id: randomUUID(),
      time: new Date().toISOString(),
      method: req.method,
      route: "unmatched",
      status: 0,
      duration_ms: 0,
      upstream: [],
    };
    const live: Live = { entry };
    const t0 = process.hrtime.bigint();
    res.setHeader("x-request-id", entry.request_id);
    res.on("finish", () => {
      entry.status = res.statusCode;
      entry.duration_ms = Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10;
      const pattern = req.route?.path ?? "unmatched";
      entry.route = `${req.method} ${pattern}`;
      if (req.learnerId) live.learnerId = req.learnerId;
      this.trace.finish(live);
      requestLogSink(JSON.stringify({ time: entry.time, service: "gateway", method: req.method, route: pattern, status: entry.status, duration_ms: entry.duration_ms, request_id: entry.request_id }));
    });
    this.trace.run(live, next);
  }
}
