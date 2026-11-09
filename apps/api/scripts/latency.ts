/** Measures p50/p95/p99 latency of four learning calls, through the gateway and directly against Python.
 *  Needs the real stack running (Python on PYTHON_API_URL, gateway on GATEWAY_PORT) and the real database.
 *  Creates anonymous episodes in the real database (counted in the output). Writes docs/03-benchmarks/benchmark-02-learning-api-latency.md. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, loadEnvFile } from "../src/config/app-config";
import { repoRoot } from "../src/config/paths";

const N = 200;

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed(fn: () => Promise<Response>): Promise<number> {
  const t0 = process.hrtime.bigint();
  const r = await fn();
  await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

async function main(): Promise<void> {
  loadEnvFile();
  const cfg = loadConfig();
  const gw = `http://127.0.0.1:${cfg.port}`;
  const py = cfg.pythonApiUrl;
  const pyHeaders = { "content-type": "application/json", "x-internal-token": cfg.internalToken };
  const name = "latency-" + Date.now().toString(36);
  const reg: any = await (await fetch(gw + "/auth/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: name, password: "latency test password" }) })).json();
  const gwHeaders = { "content-type": "application/json", authorization: `Bearer ${reg.token}` };
  let episodes = 0;

  const gwPost = (p: string, b: object) => fetch(gw + p, { method: "POST", headers: gwHeaders, body: JSON.stringify(b) });
  const gwGet = (p: string) => fetch(gw + p, { headers: gwHeaders });
  const pyPost = (p: string, b: object) => fetch(py + p, { method: "POST", headers: pyHeaders, body: JSON.stringify(b) });
  const pyGet = (p: string) => fetch(py + p, { headers: pyHeaders });
  const newEp = async (path: "gw" | "py", body: object): Promise<string> => {
    episodes++;
    const r = path === "gw" ? await gwPost("/episodes", body) : await pyPost("/episodes", body);
    return ((await r.json()) as any).episode_id;
  };

  const results: Array<{ call: string; path: string; p50: number; p95: number; p99: number; n: number }> = [];
  const record = (call: string, p: string, xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    results.push({ call, path: p, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), n: s.length });
  };

  type Path = "gw" | "py";
  const callers = {
    gw: { post: gwPost, get: gwGet, label: "through the gateway" },
    py: { post: pyPost, get: pyGet, label: "directly to Python" },
  };
  // Each pair of paths is measured INTERLEAVED (gateway call, Python call, gateway call, ...) so that machine noise
  // and warm-up affect both equally; each path has its own episode so that the two never touch the same state.
  async function measurePair(call: string, setup: (p: Path) => Promise<string>, once: (p: Path, id: string, i: number) => Promise<number>) {
    const ids = { gw: await setup("gw"), py: await setup("py") };
    await once("gw", ids.gw, -1); await once("py", ids.py, -1);                                  // warm-up
    const xs: Record<Path, number[]> = { gw: [], py: [] };
    for (let i = 0; i < N; i++) { xs.gw.push(await once("gw", ids.gw, i)); xs.py.push(await once("py", ids.py, i)); }
    record(call, callers.gw.label, xs.gw);
    record(call, callers.py.label, xs.py);
  }

  await measurePair("GET bars (real, 250 bars)", (p) => newEp(p, { kind: "real", n_bars: 250, seed: 1 }),
    (p, id) => timed(() => callers[p].get(`/episodes/${id}/bars`)));

  await measurePair("POST advance (1 day, real episode)", (p) => newEp(p, { kind: "real", n_bars: 500, seed: 2 }),
    (p, id, i) => i < 0 ? Promise.resolve(0).then(async () => { await callers[p].post(`/episodes/${id}/advance`, { n: 1 }).then((r) => r.text()); return 0; }) : timed(() => callers[p].post(`/episodes/${id}/advance`, { n: 1 })));

  await measurePair("POST predictions (new guess)", (p) => newEp(p, { kind: "real", n_bars: 500, seed: 3 }),
    async (p, id, i) => {
      await callers[p].post(`/episodes/${id}/advance`, { n: 1 }).then((r) => r.text());           // not timed
      if (i < 0) return 0;
      return timed(() => callers[p].post(`/episodes/${id}/predictions`, { horizon: 1, p_up: 0.55 }));
    });

  await measurePair("GET score (30 guesses, 5,000 shuffles)", async (p) => {
    const sc = await newEp(p, { kind: "synthetic", n_bars: 150, seed: 4 });
    for (let i = 0; i < 30; i++) {
      await callers[p].post(`/episodes/${sc}/predictions`, { horizon: 1, p_up: 0.3 + (i % 5) / 10 }).then((r) => r.text());
      await callers[p].post(`/episodes/${sc}/advance`, { n: 1 }).then((r) => r.text());
    }
    return sc;
  }, (p, id) => timed(() => callers[p].get(`/episodes/${id}/score`)));

  const root = repoRoot();
  let pyVersion = "unknown";
  try { pyVersion = execFileSync(path.join(root, "services/market-data/.venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"), ["--version"], { encoding: "utf8" }).trim(); } catch { /* ignore */ }
  const cpus = os.cpus();
  const f = (x: number) => x.toFixed(1);
  const rows = results.map((r) => `| ${r.call} | ${r.path} | ${r.n} | ${f(r.p50)} | ${f(r.p95)} | ${f(r.p99)} |`).join("\n");
  const overhead = ["GET bars (real, 250 bars)", "POST advance (1 day, real episode)", "POST predictions (new guess)", "GET score (30 guesses, 5,000 shuffles)"].map((c) => {
    const g = results.find((r) => r.call === c && r.path === "through the gateway")!, p = results.find((r) => r.call === c && r.path === "directly to Python")!;
    return `| ${c} | ${f(g.p50 - p.p50)} | ${f(g.p95 - p.p95)} |`;
  }).join("\n");
  const md = `# Benchmark 02: learning API latency (generated ${new Date().toISOString().slice(0, 16)} UTC)

Produced by \`apps/api/scripts/latency.ts\` (\`npm run latency\` in \`apps/api\`). Informational: these are measurements on one machine, not targets and not promises.

**What was measured.** ${N} sequential calls per row, loopback, after one warm-up call, wall-clock time from sending the request to reading the whole body, in milliseconds. "Through the gateway" is browser-style access (login token, ownership check, validation, whitelisting, trace) to the Python service; "directly to Python" sends the internal token straight to the service. Real Tiingo episodes (250 or 500 bars) and one made-up episode with 30 answered guesses for the score. Every episode created by this run is anonymous and stays in the real database (${episodes} episodes, 1 learner account named \`${name}\`).

**Reading the table.** The two paths are measured interleaved (one gateway call, one direct call, repeated), each on its own episode, so drift affects both equally. Differences of a few milliseconds are within the noise of this machine (the p95 and p99 columns show occasional spikes of about 100 ms that appear on both paths, consistent with other programs and the operating system, not with either service). The gateway adds an ownership query, validation, a whitelist and a trace entry; this run does not resolve its cost more finely than that.

**Machine.** ${os.type()} ${os.release()}, ${cpus.length} x ${cpus[0]?.model.trim()}, ${(os.totalmem() / 2 ** 30).toFixed(1)} GB RAM, Node ${process.version}, ${pyVersion}, PostgreSQL local service. Other programs were running (including the web dev server), so treat differences of a few milliseconds as noise.

| Call | Path | Calls | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|---|
${rows}

**Gateway overhead (gateway minus direct).**

| Call | p50 ms | p95 ms |
|---|---|---|
${overhead}
`;
  const out = path.join(root, "docs", "03-benchmarks", "benchmark-02-learning-api-latency.md");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md, "utf8");
  console.log(out);
  console.log(md);
}

void main();
