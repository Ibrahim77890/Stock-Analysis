import { Injectable, NestMiddleware } from "@nestjs/common";
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

@Injectable()
export class TraceService {
  private readonly als = new AsyncLocalStorage<Live>();
  private readonly byLearner = new Map<string, TraceEntry[]>();

  run<T>(live: Live, fn: () => T): T {
    return this.als.run(live, fn);
  }

  /** Called by the Python client for every upstream call. */
  addUpstream(e: UpstreamEntry): void {
    this.als.getStore()?.entry.upstream.push(e);
  }

  setLearner(id: string): void {
    const s = this.als.getStore();
    if (s) s.learnerId = id;
  }

  finish(live: Live): void {
    if (!live.learnerId) return; // only logged-in learners are traced
    const list = this.byLearner.get(live.learnerId) ?? [];
    list.push(live.entry);
    while (list.length > BUFFER) list.shift();
    this.byLearner.set(live.learnerId, list);
  }

  last(learnerId: string, limit = 50): TraceEntry[] {
    const list = this.byLearner.get(learnerId) ?? [];
    return list.slice(-Math.max(1, Math.min(limit, BUFFER))).reverse();
  }

  size(learnerId: string): number {
    return this.byLearner.get(learnerId)?.length ?? 0;
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
    });
    this.trace.run(live, next);
  }
}
