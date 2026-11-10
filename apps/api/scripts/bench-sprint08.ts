/** Sprint 08 measurements. Needs the real database (DATABASE_URL) with the lessons seeded, and the gateway running on GATEWAY_PORT.
 *  Writes docs/03-benchmarks/benchmark-04-durable-limits-overhead.md and benchmark-05-lessons-latency.md.
 *  Creates two throwaway learners in the real database (counted in the output). */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import type { AddressInfo } from "node:net";
import { buildApp } from "../src/bootstrap";
import { loadConfig, loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";
import { DbService } from "../src/db/db.service";
import { RateLimiter } from "../src/auth/auth.service";
import { LimiterFactory } from "../src/limits/db-rate-limiter";
import { TraceService } from "../src/trace/trace.service";

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const f = (x: number) => x.toFixed(2);
const stats = (a: number[]) => ({ p50: pct(a, 50), p95: pct(a, 95), max: Math.max(...a) });
async function time(fn: () => Promise<unknown>, n: number): Promise<number[]> {
  for (let i = 0; i < 10; i++) await fn(); // warm-up
  const out: number[] = [];
  for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); await fn(); out.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  return out;
}
function machine(): string {
  let git = "unknown";
  try { git = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot(), encoding: "utf8" }).trim(); } catch { /* none */ }
  return `${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${os.type()} ${os.release()}, node ${process.version}, PostgreSQL on localhost, git ${git} (working tree)`;
}

async function main(): Promise<void> {
  loadEnvFile();
  const cfg = loadConfig();
  const N = 200;
  const bench = path.join(repoRoot(), "docs/03-benchmarks");

  // ---------- 04: durable limiter and trace overhead (in process, real database)
  const db = new DbService(cfg);
  const factory = new LimiterFactory(db);
  const mem = new RateLimiter(1_000_000);
  const dbLim = factory.make("bench", 1_000_000);
  const limMem = await time(async () => mem.allow("k"), N);
  const limDb = await time(() => dbLim.allow("k"), N);
  await db.query("DELETE FROM app.rate_event WHERE kind = 'bench'");

  const mk = async (durableTrace: boolean) => {
    const { Test } = await import("@nestjs/testing");
    void Test;
    const app = await buildApp(cfg, durableTrace ? (b: any) => b : (b: any) => b.overrideProvider(TraceService).useValue(new TraceService()));
    await app.listen(0, "127.0.0.1");
    return { app, url: `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}` };
  };
  const name = "bench-" + Date.now().toString(36);
  const a = await mk(true), b = await mk(false);
  const reg: any = await (await fetch(a.url + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: name + "a", password: "benchmark password 1" }) })).json();
  const call = (url: string) => async () => { const r = await fetch(url + "/lab/studies", { headers: { authorization: `Bearer ${reg.token}` } }); await r.text(); if (!r.ok) throw new Error(String(r.status)); };
  const reqDb = await time(call(a.url), N), reqMem = await time(call(b.url), N);
  await a.app.close(); await b.app.close();
  const ld = stats(limDb), lm = stats(limMem), rd = stats(reqDb), rm = stats(reqMem);
  fs.writeFileSync(path.join(bench, "benchmark-04-durable-limits-overhead.md"), `# Benchmark 04: what the durable limiter and trace cost

Measured ${new Date().toISOString().slice(0, 10)} by \`apps/api/scripts/bench-sprint08.ts\` (\`npm run bench:sprint08\`).

**Machine:** ${machine()}.

**Method:** ${N} sequential calls after 10 warm-up calls, one process, the real \`marketlab\` database on the same machine.
The limiter is timed directly (one \`allow\` call). The trace is timed through \`GET /lab/studies\` (a call that touches only the gateway database) against two in-process gateways: one with the durable trace (a row written to \`app.request_log\` after the reply) and one with the old in-memory trace.

| What | p50 ms | p95 ms | max ms |
|---|---|---|---|
| Limiter, in memory (old) | ${f(lm.p50)} | ${f(lm.p95)} | ${f(lm.max)} |
| Limiter, PostgreSQL (new; one transaction with an advisory lock) | ${f(ld.p50)} | ${f(ld.p95)} | ${f(ld.max)} |
| \`GET /lab/studies\`, in-memory trace (old) | ${f(rm.p50)} | ${f(rm.p95)} | ${f(rm.max)} |
| \`GET /lab/studies\`, durable trace (new) | ${f(rd.p50)} | ${f(rd.p95)} | ${f(rd.max)} |

**Reading:** the database limiter adds about ${f(ld.p50 - lm.p50)} ms at the median per limited call. Only login, Lab runs, vault tries and lesson answers use it. The trace write happens after the reply is sent, so it adds ${f(rd.p50 - rm.p50)} ms at the median to the measured call (the difference is within normal noise when it is small).

**What this does not show:** many learners at once, a database on another machine, or a cold cache. The numbers are for one machine, one learner, one process. No target was set before measuring.
`);
  console.log("04", { limMem: lm, limDb: ld, reqMem: rm, reqDb: rd });

  // ---------- 05: lessons latency, through the gateway (:GATEWAY_PORT) versus the same reads straight from the database
  const gw = `http://127.0.0.1:${cfg.port}`;
  const reg2: any = await (await fetch(gw + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: name + "b", password: "benchmark password 2" }) })).json();
  const H = { "content-type": "application/json", authorization: `Bearer ${reg2.token}` };
  const get = (p: string) => async () => { const r = await fetch(gw + p, { headers: H }); await r.text(); if (!r.ok) throw new Error(String(r.status)); };
  const post = (p: string, body: object) => async () => { const r = await fetch(gw + p, { method: "POST", headers: H, body: JSON.stringify(body) }); await r.text(); if (!r.ok) throw new Error(String(r.status)); };
  const G = 100;
  const gList = stats(await time(get("/lessons"), G));
  const gOne = stats(await time(get("/lessons/brier-score"), G));
  // answers are limited to 60 a minute per learner: use a fresh learner for each 50 calls
  const answers: number[] = [];
  for (let i = 0; i < 2; i++) {
    const r2: any = await (await fetch(gw + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: `${name}c${i}`, password: "benchmark password 3" }) })).json();
    const h2 = { "content-type": "application/json", authorization: `Bearer ${r2.token}` };
    for (let k = 0; k < 50; k++) {
      const t0 = process.hrtime.bigint();
      const r = await fetch(gw + "/lessons/brier-score/questions/1/answer", { method: "POST", headers: h2, body: JSON.stringify({ option: 0 }) });
      await r.text();
      if (!r.ok) throw new Error(String(r.status));
      answers.push(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  }
  void post;
  const gAns = stats(answers);
  const dList = stats(await time(() => db.query("SELECT slug FROM app.lesson ORDER BY position"), G));
  const dOne = stats(await time(() => db.query("SELECT content FROM app.lesson WHERE slug = 'brier-score'"), G));
  const dAns = stats(await time(() => db.query("SELECT options FROM app.lesson_question WHERE lesson_slug = 'brier-score' AND position = 1"), G));
  await db.query("DELETE FROM app.learner WHERE display_name_key LIKE $1", [name + "%"]);
  await db.onModuleDestroy();
  fs.writeFileSync(path.join(bench, "benchmark-05-lessons-latency.md"), `# Benchmark 05: lessons latency

Measured ${new Date().toISOString().slice(0, 10)} by \`apps/api/scripts/bench-sprint08.ts\`.

**Machine:** ${machine()}.

**Method:** ${G} calls per row (answers: ${answers.length}, spread over two throwaway learners because one learner may send 60 answers a minute), after 10 warm-up calls. "Through the gateway" is real HTTP to the running gateway with a signed-in learner. "Database only" is the main query of that route run directly with \`pg\`, to show how much time is the database and how much is the gateway. The throwaway learners were deleted afterwards.

| Route | Through the gateway p50 / p95 / max (ms) | Database only p50 / p95 / max (ms) |
|---|---|---|
| \`GET /lessons\` | ${f(gList.p50)} / ${f(gList.p95)} / ${f(gList.max)} | ${f(dList.p50)} / ${f(dList.p95)} / ${f(dList.max)} (simple query; the real route runs one larger query) |
| \`GET /lessons/:slug\` | ${f(gOne.p50)} / ${f(gOne.p95)} / ${f(gOne.max)} | ${f(dOne.p50)} / ${f(dOne.p95)} / ${f(dOne.max)} (first of three queries) |
| \`POST .../answer\` | ${f(gAns.p50)} / ${f(gAns.p95)} / ${f(gAns.max)} | ${f(dAns.p50)} / ${f(dAns.p95)} / ${f(dAns.max)} (the lookup only) |

**What this does not show:** many learners at once, a cold cache, a remote database, or network time beyond localhost. Each gateway call also includes one durable trace write and (for answers) one durable limiter check. No target was set before measuring.
`);
  console.log("05", { gList, gOne, gAns, dList, dOne, dAns });
}

void main().catch((e) => { console.error(e); process.exit(1); });
