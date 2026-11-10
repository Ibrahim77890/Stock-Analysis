/** Sprint 09 measurements: indicator and decision routes through the running gateway (real HTTP, real Python, real database).
 *  Needs the three services running. Creates four throwaway learners and episodes in the real database (deleted learners are
 *  removed; their episodes stay in research.episode and are counted in the output).
 *  Writes docs/03-benchmarks/benchmark-06-indicators-and-journal.md. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const f = (x: number) => x.toFixed(1);
const stats = (a: number[]) => ({ p50: pct(a, 50), p95: pct(a, 95), max: Math.max(...a), n: a.length });

async function main(): Promise<void> {
  loadEnvFile();
  const cfg = loadConfig();
  const gw = `http://127.0.0.1:${cfg.port}`;
  const stamp = "bench9-" + Date.now().toString(36);
  const timed = async (fn: () => Promise<Response>): Promise<number> => {
    const t0 = process.hrtime.bigint();
    const r = await fn();
    await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  const learners: Array<{ H: Record<string, string>; ep: string }> = [];
  for (let i = 0; i < 4; i++) {
    const reg: any = await (await fetch(gw + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: `${stamp}-${i}`, password: "benchmark password 9" }) })).json();
    const H = { "content-type": "application/json", authorization: `Bearer ${reg.token}` };
    const ep: any = await (await fetch(gw + "/episodes", { method: "POST", headers: H, body: JSON.stringify({ kind: "synthetic", n_bars: 250, initial_visible: 60, seed: 40 + i }) })).json();
    learners.push({ H, ep: ep.episode_id });
  }
  const get = (l: (typeof learners)[number], p: string) => () => fetch(gw + p, { headers: l.H });
  // warm-up
  for (let i = 0; i < 10; i++) await timed(get(learners[0], `/episodes/${learners[0].ep}/indicators?name=sma&window=20`));

  const ind: Record<string, number[]> = { sma: [], ema: [], rsi: [] };
  for (const [name, w] of [["sma", 20], ["ema", 20], ["rsi", 14]] as const) {
    for (let i = 0; i < 100; i++) ind[name].push(await timed(get(learners[i % 4], `/episodes/${learners[i % 4].ep}/indicators?name=${name}&window=${w}`)));
  }
  // decisions: one a day, 25 per learner (the limit is 30 a minute per learner)
  const dec: number[] = [];
  for (let k = 0; k < 25; k++) {
    for (const [i, l] of learners.entries()) {
      await fetch(gw + `/episodes/${l.ep}/advance`, { method: "POST", headers: l.H, body: JSON.stringify({ n: 1 }) });
      dec.push(await timed(() => fetch(gw + `/episodes/${l.ep}/decisions`, { method: "POST", headers: l.H, body: JSON.stringify({ stance: (k + i) % 2 ? "long" : "flat", reason: "Benchmark note.", client_key: `${stamp}-${i}-${k}-key`, cost_bps: 2 }) })));
    }
  }
  const jr: number[] = [];
  for (let i = 0; i < 100; i++) jr.push(await timed(get(learners[i % 4], `/episodes/${learners[i % 4].ep}/decisions`)));
  const total = Object.values(ind).reduce((n, a) => n + a.length, 0) + dec.length + jr.length;
  let git = "unknown";
  try { git = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot(), encoding: "utf8" }).trim(); } catch { /* none */ }
  const s = { sma: stats(ind.sma), ema: stats(ind.ema), rsi: stats(ind.rsi), dec: stats(dec), jr: stats(jr) };
  const row = (n: string, x: ReturnType<typeof stats>) => `| ${n} | ${x.n} | ${f(x.p50)} | ${f(x.p95)} | ${f(x.max)} |`;
  fs.writeFileSync(path.join(repoRoot(), "docs/03-benchmarks/benchmark-06-indicators-and-journal.md"), `# Benchmark 06: indicators and practice decisions

Measured ${new Date().toISOString().slice(0, 10)} by \`apps/api/scripts/bench-sprint09.ts\` (\`npm run bench:sprint09\`).

**Machine:** ${os.cpus()[0]?.model.trim()} (${os.cpus().length} threads), ${(os.totalmem() / 2 ** 30).toFixed(0)} GB RAM, ${os.type()} ${os.release()}, node ${process.version}, Python service and PostgreSQL on the same machine, git ${git} (working tree).

**Method:** real HTTP to the running gateway, which calls the real Python service and the real database. Four throwaway learners, each with one made-up 250-day episode (60 days visible at the start). Indicator reads: 100 calls each after 10 warm-up calls, spread over the four episodes. Decisions: 25 per learner, one a day, after advancing the episode by one day (the advance is not timed); the journal read is timed with up to 25 decisions stored. Each call includes ownership check, the durable trace write and, for decisions, one durable limiter check.

| Call | Calls | p50 ms | p95 ms | max ms |
|---|---|---|---|---|
${row("GET indicators (sma, window 20)", s.sma)}
${row("GET indicators (ema, window 20)", s.ema)}
${row("GET indicators (rsi, window 14)", s.rsi)}
${row("POST decision", s.dec)}
${row("GET decisions (journal, up to 25 rows)", s.jr)}

**Reading:** every call reads the episode's blind bars and recomputes (indicators) or recomputes every result from the stored rows (journal). The journal read grows with the number of decisions and days; an episode holds at most 500 days and 250 decisions.

**What this does not show:** many learners at once, a cold cache, real (not made-up) episodes, which read split-adjusted bars from the database and are slower, or a remote database. No target was set before measuring. ${total} calls were made; the throwaway learners were deleted, their four episodes and ${dec.length} decisions remain in \`research\` (decisions cannot be deleted by design).
`);
  console.log(s);
  const pg = await import("pg");
  const pool = new pg.Pool({ connectionString: cfg.databaseUrl });
  await pool.query("DELETE FROM app.learner WHERE display_name_key LIKE $1", [stamp + "%"]);
  await pool.end();
}

void main().catch((e) => { console.error(e); process.exit(1); });
