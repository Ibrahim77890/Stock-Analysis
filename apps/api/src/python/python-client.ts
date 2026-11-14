import { HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG, AppConfig, redact } from "../config/app-config";
import { TraceService } from "../trace/trace.service";

/** An upstream failure turned into a safe message for the browser (no URL, token or upstream body). */
export class UpstreamError extends HttpException {
  constructor(status: number, message: string) {
    super({ statusCode: status, message }, status);
  }
}

const SAFE: Record<number, string> = {
  404: "That episode was not found.",
  409: "This episode is already revealed.",
  422: "That request does not fit the rules. Please check the numbers.",
  502: "The number service had a problem. Please try again.",
  504: "The number service took too long. Please try again.",
};

export const DEFAULT_TIMEOUT_MS = 5_000;
export const SCORE_TIMEOUT_MS = 30_000;
export const LAB_RUN_TIMEOUT_MS = 30_000;

const SAFE_LAB: Record<number, string> = {
  404: "That study or stock was not found.",
  409: "The vault of this study was already opened.",
  422: "That request does not fit the rules. Please check the numbers.",
  502: "The number service had a problem. Please try again.",
  504: "The number service took too long. Please try again.",
};

/** Thin typed client for the Python analytics service. The gateway computes nothing: it forwards and maps errors. */
@Injectable()
export class PythonClient {
  private readonly log = new Logger("PythonClient");

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig, private readonly trace: TraceService) {}

  private async call<T>(method: "GET" | "POST", path: string, pattern: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS, lab = false, plain422 = false): Promise<T> {
    const SAFE_MSG = lab ? SAFE_LAB : SAFE;
    const t0 = process.hrtime.bigint();
    const done = (status: number) =>
      this.trace.addUpstream({ service: "python", route: `${method} ${pattern}`, status, duration_ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10 });
    let res: Response;
    try {
      res = await fetch(this.cfg.pythonApiUrl + path, {
        method,
        headers: { "content-type": "application/json", "x-internal-token": this.cfg.internalToken, ...(this.trace.currentRequestId() ? { "x-request-id": this.trace.currentRequestId()! } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e: any) {
      const timedOut = e?.name === "TimeoutError" || e?.name === "AbortError";
      done(timedOut ? 504 : 502);
      this.log.warn(redact(`upstream ${method} ${pattern} failed: ${e?.name ?? "error"}`, this.cfg));
      throw new UpstreamError(timedOut ? 504 : 502, SAFE_MSG[timedOut ? 504 : 502]);
    }
    done(res.status);
    if (res.ok) return (await res.json()) as T;
    // upstream 4xx keep their status with a safe message; 5xx become 502
    const status = res.status >= 500 ? 502 : res.status;
    this.log.warn(`upstream ${method} ${pattern} answered ${res.status}`);
    let message = SAFE_MSG[status] ?? "The request could not be completed.";
    if ((lab || plain422) && status === 422) {
      // the Lab's own limit messages are plain sentences written for learners; anything else stays generic
      const detail = await res.json().then((j: any) => j?.detail, () => undefined);
      if (typeof detail === "string" && detail.length <= 300) message = detail;
    }
    throw new UpstreamError(status, message);
  }

  async health(timeoutMs = 2_000): Promise<boolean> {
    try {
      const res = await fetch(this.cfg.pythonApiUrl + "/health", { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok;
    } catch {
      return false;
    }
  }

  createEpisode(body: { kind: string; n_bars: number; initial_visible: number; seed?: number }) {
    return this.call<any>("POST", "/episodes", "/episodes", body);
  }
  states(ids: string[]) {
    return this.call<{ episodes: any[] }>("POST", "/episodes/states", "/episodes/states", { episode_ids: ids });
  }
  getEpisode(id: string) {
    return this.call<any>("GET", `/episodes/${encodeURIComponent(id)}`, "/episodes/:id");
  }
  bars(id: string) {
    return this.call<any>("GET", `/episodes/${encodeURIComponent(id)}/bars`, "/episodes/:id/bars");
  }
  advance(id: string, n: number) {
    return this.call<any>("POST", `/episodes/${encodeURIComponent(id)}/advance`, "/episodes/:id/advance", { n });
  }
  addPrediction(id: string, horizon: number, p_up: number) {
    return this.call<any>("POST", `/episodes/${encodeURIComponent(id)}/predictions`, "/episodes/:id/predictions", { horizon, p_up });
  }
  predictions(id: string) {
    return this.call<any>("GET", `/episodes/${encodeURIComponent(id)}/predictions`, "/episodes/:id/predictions");
  }
  score(id: string) {
    return this.call<any>("GET", `/episodes/${encodeURIComponent(id)}/score`, "/episodes/:id/score", undefined, SCORE_TIMEOUT_MS);
  }
  reveal(id: string) {
    return this.call<any>("POST", `/episodes/${encodeURIComponent(id)}/reveal`, "/episodes/:id/reveal");
  }
  summary(ids: string[]) {
    return this.call<any>("POST", "/learning/summary", "/learning/summary", { episode_ids: ids }, SCORE_TIMEOUT_MS);
  }

  // ---- Operations (Sprint 10)
  metrics() {
    return this.call<any>("GET", "/metrics", "/metrics");
  }
  dataStatus() {
    return this.call<any>("GET", "/data/status", "/data/status");
  }

  // ---- Indicators and practice decisions (Sprint 09); 422 messages from these routes are plain sentences for learners
  indicators(id: string, name: string, window: number) {
    return this.call<any>("GET", `/episodes/${encodeURIComponent(id)}/indicators?name=${encodeURIComponent(name)}&window=${window}`, "/episodes/:id/indicators", undefined, DEFAULT_TIMEOUT_MS, false, true);
  }
  recordDecision(id: string, body: object) {
    return this.call<any>("POST", `/episodes/${encodeURIComponent(id)}/decisions`, "/episodes/:id/decisions", body, DEFAULT_TIMEOUT_MS, false, true);
  }
  decisions(id: string) {
    return this.call<any>("GET", `/episodes/${encodeURIComponent(id)}/decisions`, "/episodes/:id/decisions", undefined, DEFAULT_TIMEOUT_MS, false, true);
  }

  // ---- Strategy Lab (Sprint 07)
  labStocks() {
    return this.call<any>("GET", "/lab/stocks", "/lab/stocks", undefined, DEFAULT_TIMEOUT_MS, true);
  }
  labCreate(body: { symbol: string; name?: string }) {
    return this.call<any>("POST", "/lab/studies", "/lab/studies", body, DEFAULT_TIMEOUT_MS, true);
  }
  labInfo(ids: number[]) {
    return this.call<any>("POST", "/lab/studies/info", "/lab/studies/info", { study_ids: ids }, LAB_RUN_TIMEOUT_MS, true);
  }
  labOverview(id: number) {
    return this.call<any>("GET", `/lab/studies/${id}`, "/lab/studies/:id", undefined, DEFAULT_TIMEOUT_MS, true);
  }
  labRun(id: number, body: object) {
    return this.call<any>("POST", `/lab/studies/${id}/runs`, "/lab/studies/:id/runs", body, LAB_RUN_TIMEOUT_MS, true);
  }
  labVault(id: number, body: object) {
    return this.call<any>("POST", `/lab/studies/${id}/vault`, "/lab/studies/:id/vault", body, LAB_RUN_TIMEOUT_MS, true);
  }
  labSavedVault(id: number) {
    return this.call<any>("GET", `/lab/studies/${id}/vault`, "/lab/studies/:id/vault", undefined, LAB_RUN_TIMEOUT_MS, true);
  }
}
