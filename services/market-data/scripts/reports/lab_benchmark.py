"""Strategy Lab latency (Sprint 07, tasks 07_02 and 07_08). Needs the Python service (:8000) and the gateway (:3000) running.

Writes docs/03-benchmarks/benchmark-03-lab-run-latency.md. Informational: one machine, warm caches, not targets.
Creates one throwaway learner (lab-bench-xxxx) and three studies in the real database; they are listed in the note.

Run from services/market-data:   .venv/Scripts/python.exe scripts/reports/lab_benchmark.py
"""

import json
import os
import platform
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import psycopg

from market_data.core import config
from market_data.lab import study as lab

PY = "http://127.0.0.1:8000"
GW = "http://127.0.0.1:3000"
TOKEN = os.environ.get("INTERNAL_API_TOKEN", "")
OUT = config.DOCS_DIR / "03-benchmarks" / "benchmark-03-lab-run-latency.md"


def call(base, method, path, body=None, headers=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"content-type": "application/json", **(headers or {})})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    return (time.perf_counter() - t0) * 1000, status, len(raw), json.loads(raw or b"null")


def stats(ms):
    s = sorted(ms)
    p95 = s[min(len(s) - 1, int(round(0.95 * (len(s) - 1))))]
    return statistics.median(s), p95, s[-1]


def main() -> int:
    # direct function (no HTTP) on the real database
    conn = psycopg.connect(config.database_url())
    sid = lab.create_lab_study(conn, "AAPL")["study_id"]
    rows = []
    cases = [("typical: slow 50, 100 mixed-up histories", dict(fast=10, slow=50, cost_bps=2.0, seed=1, n_paths=100)),
             ("largest allowed: slow 300, 200 mixed-up histories", dict(fast=5, slow=300, cost_bps=2.0, seed=1, n_paths=200))]
    direct = {}
    for label, kw in cases:
        lab.run_practice(conn, sid, **kw)  # warm-up (also records the trial; repeats are not counted)
        ms = []
        for _ in range(20):
            t0 = time.perf_counter()
            lab.run_practice(conn, sid, **kw)
            ms.append((time.perf_counter() - t0) * 1000)
        direct[label] = ms
    conn.close()

    # through HTTP to Python, and through the gateway (the gateway allows 20 runs a minute per learner)
    hdr = {"x-internal-token": TOKEN} if TOKEN else {}
    _, _, _, made = call(PY, "POST", "/lab/studies", {"symbol": "AAPL"}, hdr)
    py_sid = made["study_id"]
    name = "lab-bench-" + hex(int(time.time()))[2:]
    _, st, _, reg = call(GW, "POST", "/auth/register", {"display_name": name, "password": "a few random words here"})
    assert st == 200, reg
    auth = {"authorization": "Bearer " + reg["token"]}
    _, st, _, gmade = call(GW, "POST", "/lab/studies", {"symbol": "AAPL"}, auth)
    assert st == 200, gmade
    gw_sid = gmade["study_id"]
    http_rows = []
    sizes = {}
    for label, kw in cases:
        body = {k: v for k, v in kw.items()}
        call(PY, "POST", f"/lab/studies/{py_sid}/runs", body, hdr)
        py_ms, gw_ms = [], []
        n = 10 if "typical" in label else 8  # keeps each minute under the gateway's 20 runs a minute
        for i in range(n):
            ms, st, size, _ = call(PY, "POST", f"/lab/studies/{py_sid}/runs", body, hdr)
            assert st == 200
            py_ms.append(ms)
            ms, st, size, _ = call(GW, "POST", f"/lab/studies/{gw_sid}/runs", body, auth)
            assert st == 200, st
            gw_ms.append(ms)
            sizes[label] = size
        http_rows.append((label, py_ms, gw_ms))
        time.sleep(61)  # let the per-minute window pass

    # a cheap read, interleaved, to show the gateway's own overhead
    cheap_py, cheap_gw = [], []
    for _ in range(30):
        cheap_py.append(call(PY, "GET", f"/lab/studies/{py_sid}", None, hdr)[0])
        cheap_gw.append(call(GW, "GET", f"/lab/studies/{gw_sid}", None, auth)[0])

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M UTC")
    lines = [
        f"# Benchmark 03: Strategy Lab run latency (generated {now})", "",
        "Produced by `services/market-data/scripts/reports/lab_benchmark.py`. Informational: measurements on one machine with warm caches, not targets and not promises.", "",
        "**What was measured.** One run is `POST /lab/studies/{id}/runs`: the rule and buy and hold on the 17-year practice window of AAPL (4,278 daily bars), a cost table at five levels, the luck check with block-bootstrap paths, the trial record and the overfitting meter. "
        "'Direct function' calls `run_practice` inside Python (no HTTP). 'Python HTTP' sends the internal token to the service. 'Gateway' is the browser path (sign-in token, ownership check, validation, rate limit, whitelisting, trace). "
        "A first call per case is discarded; the repeated rule is recomputed each time (not counted again).", "",
        f"**Machine.** {platform.system()} {platform.release()}, {os.cpu_count()} logical CPUs, Python {platform.python_version()}, local PostgreSQL. Other programs were running (the web dev server and the browser), so treat small differences as noise.", "",
        "| Run | Path | Calls | p50 s | p95 s | max s |", "|---|---|---|---|---|---|",
    ]
    for label, ms in direct.items():
        p50, p95, mx = stats(ms)
        lines.append(f"| {label} | direct function | {len(ms)} | {p50 / 1000:.2f} | {p95 / 1000:.2f} | {mx / 1000:.2f} |")
    for label, py_ms, gw_ms in http_rows:
        for path, ms in (("Python HTTP", py_ms), ("gateway", gw_ms)):
            p50, p95, mx = stats(ms)
            lines.append(f"| {label} | {path} | {len(ms)} | {p50 / 1000:.2f} | {p95 / 1000:.2f} | {mx / 1000:.2f} |")
    pp, pg = stats(cheap_py), stats(cheap_gw)
    lines += ["", "**Cheap read (`GET /lab/studies/{id}`), 30 interleaved calls.**", "",
              "| Path | p50 ms | p95 ms | max ms |", "|---|---|---|---|",
              f"| Python HTTP | {pp[0]:.1f} | {pp[1]:.1f} | {pp[2]:.1f} |", f"| gateway | {pg[0]:.1f} | {pg[1]:.1f} | {pg[2]:.1f} |", "",
              "**Response size.** " + "; ".join(f"{k}: {v / 1000:.1f} KB" for k, v in sizes.items()) + " (the equity curves are cut to at most 300 points).", "",
              "**What this does not show.** One machine, one stock, warm database and file caches, one user at a time. It says nothing about many people using the Lab together. "
              "The run time is dominated by the luck check (one backtest per mixed-up history), so it grows roughly with the number of mixed-up histories and with the length of the window.", "",
              f"**Left in the real database by this run.** One learner `{name}` with one study, and two studies created directly in Python (study ids {sid} and {py_sid}). They are anonymous test data."]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
