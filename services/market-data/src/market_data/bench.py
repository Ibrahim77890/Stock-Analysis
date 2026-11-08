"""PostgreSQL scale benchmark on synthetic daily bars (schema `bench`).

Commands (via the `market-data` CLI):
    bench-generate   write seeded synthetic Parquet to data/synthetic/
    bench-load       create schema bench + table, COPY the data in, ANALYZE, measure sizes
    bench-run        run workloads W1-W4 (--cold skips warm-up: run it right after restarting PostgreSQL)
    bench-report     assemble docs/03-benchmarks/benchmark-01-postgres-daily-bars.md
Results are stored as JSON in data/reports/bench/ so cold and warm runs can be combined.
"""

import io
import json
import os
import platform
import random
import statistics
import time
from datetime import date, timedelta
from pathlib import Path

import polars as pl
import psycopg

from market_data import config, synthetic

BENCH_DIR = config.REPORT_DIR / "bench"
SYN_DIR = config.DATA_DIR / "synthetic"
WARMUP, RUNS = 20, 200

DDL = """
DROP SCHEMA IF EXISTS bench CASCADE;
CREATE SCHEMA bench;
CREATE TABLE bench.bar_daily (
    instrument_id BIGINT NOT NULL,
    trade_date    DATE NOT NULL,
    source        TEXT NOT NULL DEFAULT 'synthetic',
    open          NUMERIC(18, 6) NOT NULL,
    high          NUMERIC(18, 6) NOT NULL,
    low           NUMERIC(18, 6) NOT NULL,
    close         NUMERIC(18, 6) NOT NULL,
    volume        BIGINT NOT NULL,
    PRIMARY KEY (instrument_id, trade_date, source),
    CHECK (open > 0 AND high > 0 AND low > 0 AND close > 0),
    CHECK (high >= GREATEST(open, close, low)),
    CHECK (low <= LEAST(open, close, high)),
    CHECK (volume >= 0)
);
"""


DATE_INDEX_SQL = "CREATE INDEX bench_bar_daily_date_idx ON bench.bar_daily (trade_date, instrument_id) INCLUDE (close)"


def _save(name: str, obj: dict) -> None:
    BENCH_DIR.mkdir(parents=True, exist_ok=True)
    (BENCH_DIR / f"{name}.json").write_text(json.dumps(obj, indent=2, sort_keys=True, default=str))


def _load_json(name: str) -> dict | None:
    p = BENCH_DIR / f"{name}.json"
    return json.loads(p.read_text()) if p.exists() else None


def generate() -> dict:
    t0 = time.perf_counter()
    paths = synthetic.write_dataset(SYN_DIR)
    info = {"seed": synthetic.SEED, "symbols": synthetic.N_SYMBOLS, "sessions": synthetic.N_SESSIONS,
            "rows": synthetic.N_SYMBOLS * synthetic.N_SESSIONS, "files": len(paths),
            "bytes": sum(p.stat().st_size for p in paths), "seconds": round(time.perf_counter() - t0, 1)}
    _save("dataset", info)
    return info


def load(conn: psycopg.Connection, date_index: bool = False, save_as: str = "load") -> dict:
    """Create schema bench and COPY the synthetic data in. date_index=True creates the
    (trade_date, instrument_id) index BEFORE loading, to measure its effect on load throughput."""
    files = sorted(SYN_DIR.glob("synthetic_bars_*.parquet"))
    if not files:
        raise RuntimeError("no synthetic data; run bench-generate first")
    with conn.cursor() as cur:
        cur.execute(DDL)
        if date_index:
            cur.execute(DATE_INDEX_SQL)
    conn.commit()
    rows, t0 = 0, time.perf_counter()
    with conn.cursor() as cur:
        for f in files:
            df = pl.read_parquet(f)
            buf = io.BytesIO()
            df.write_csv(buf, include_header=False)
            with cur.copy("COPY bench.bar_daily (instrument_id, trade_date, open, high, low, close, volume) "
                          "FROM STDIN (FORMAT csv)") as cp:
                cp.write(buf.getvalue())
            rows += df.height
    conn.commit()
    load_s = time.perf_counter() - t0
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("ANALYZE bench.bar_daily")
        cur.execute("SELECT pg_total_relation_size('bench.bar_daily'), pg_relation_size('bench.bar_daily'), "
                    "pg_indexes_size('bench.bar_daily')")
        total, table, index = cur.fetchone()
    conn.autocommit = False
    info = {"rows": rows, "load_seconds": round(load_s, 1), "rows_per_second": round(rows / load_s),
            "total_bytes": total, "table_bytes": table, "index_bytes": index,
            "includes_pk_index_during_load": True}
    info["date_index_present_during_load"] = date_index
    _save(save_as, info)
    return info


def _pct(xs: list[float], q: float) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, int(round(q * (len(s) - 1))))]


def _summary(ms: list[float]) -> dict:
    return {"p50_ms": round(_pct(ms, .5), 3), "p95_ms": round(_pct(ms, .95), 3),
            "p99_ms": round(_pct(ms, .99), 3), "mean_ms": round(statistics.fmean(ms), 3), "n": len(ms)}


def _workloads(rng: random.Random):
    n, s = synthetic.N_SYMBOLS, synthetic.sessions()
    first, last = s[0].astype(date), s[-1].astype(date)

    def w1():
        y = rng.randint(first.year, last.year - 1)
        return ("SELECT trade_date, open, high, low, close, volume FROM bench.bar_daily "
                "WHERE instrument_id=%s AND source='synthetic' AND trade_date BETWEEN %s AND %s ORDER BY trade_date",
                (rng.randint(1, n), date(y, 1, 1), date(y, 12, 31)))

    def w2():
        return ("SELECT trade_date, open, high, low, close, volume FROM bench.bar_daily "
                "WHERE instrument_id=%s AND source='synthetic' ORDER BY trade_date", (rng.randint(1, n),))

    def w3():
        d = s[rng.randrange(len(s))].astype(date)
        return ("SELECT instrument_id, close FROM bench.bar_daily WHERE trade_date=%s AND source='synthetic'", (d,))

    def w4():
        y = rng.randint(first.year, last.year - 1)
        return ("SELECT instrument_id, trade_date, close FROM bench.bar_daily "
                "WHERE instrument_id = ANY(%s) AND source='synthetic' AND trade_date BETWEEN %s AND %s "
                "ORDER BY instrument_id, trade_date",
                (rng.sample(range(1, n + 1), 20), date(y, 1, 1), date(y, 12, 31)))

    return {"W1_one_symbol_one_year": w1, "W2_one_symbol_full_history": w2,
            "W3_cross_section_one_date": w3, "W4_20_symbols_one_year": w4}


def run(conn: psycopg.Connection, mode: str = "warm", seed: int = 1, save_as: str | None = None) -> dict:
    """mode 'warm': 20 warm-up queries then 200 timed. 'cold': no warm-up (run right after a restart)."""
    rng = random.Random(seed)
    out: dict = {"mode": mode, "seed": seed, "workloads": {}, "explain": {}}
    conn.autocommit = True
    for name, make in _workloads(rng).items():
        with conn.cursor() as cur:
            for _ in range(WARMUP if mode == "warm" else 0):
                cur.execute(*make())
                cur.fetchall()
            times = []
            for _ in range(RUNS):
                q = make()
                t = time.perf_counter()
                cur.execute(*q)
                cur.fetchall()
                times.append((time.perf_counter() - t) * 1000)
        out["workloads"][name] = _summary(times)
    for name in ("W1_one_symbol_one_year", "W3_cross_section_one_date"):
        sql, params = _workloads(random.Random(99))[name]()
        with conn.cursor() as cur:
            cur.execute("EXPLAIN (ANALYZE, BUFFERS) " + sql, params)
            plan = "\n".join(r[0] for r in cur.fetchall())
        out["explain"][name] = plan
    conn.autocommit = False
    _save(save_as or f"run_{mode}", out)
    return out


def _hardware() -> dict:
    ram = "unknown"
    try:
        if platform.system() == "Windows":
            import ctypes

            class MS(ctypes.Structure):
                _fields_ = [("l", ctypes.c_ulong), ("m", ctypes.c_ulong), ("total", ctypes.c_ulonglong),
                            ("a", ctypes.c_ulonglong), ("b", ctypes.c_ulonglong), ("c", ctypes.c_ulonglong),
                            ("d", ctypes.c_ulonglong), ("e", ctypes.c_ulonglong), ("f", ctypes.c_ulonglong)]
            m = MS(); m.l = ctypes.sizeof(MS)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            ram = f"{m.total / 2**30:.1f} GiB"
        else:
            ram = f"{int(open('/proc/meminfo').readline().split()[1]) / 2**20:.1f} GiB"
    except Exception:  # noqa: BLE001
        pass
    return {"os": platform.platform(), "cpu": platform.processor() or platform.machine(),
            "logical_cpus": os.cpu_count(), "ram": ram}


def report(conn: psycopg.Connection) -> Path:
    with conn.cursor() as cur:
        cur.execute("SHOW server_version"); version = cur.fetchone()[0]
        cur.execute("SELECT name, setting, unit FROM pg_settings WHERE name IN "
                    "('shared_buffers','work_mem','effective_cache_size','max_parallel_workers_per_gather',"
                    "'random_page_cost','synchronous_commit') ORDER BY name")
        settings = cur.fetchall()
    ds, ld = _load_json("dataset") or {}, _load_json("load") or {}
    warm, cold = _load_json("run_warm"), _load_json("run_cold")
    hw = _hardware()
    L = ["# Benchmark 01: PostgreSQL daily-bar range queries at ~12.6M rows", "",
         "All numbers below were measured on this machine by `market-data bench-*`; none are claims about other hardware.", "",
         "## Environment", "", f"- OS: {hw['os']}", f"- CPU: {hw['cpu']} ({hw['logical_cpus']} logical)", f"- RAM: {hw['ram']}",
         "- Disk: not recorded automatically (fill in by hand)", f"- PostgreSQL: {version}",
         "- Settings (current values; check `postgresql.conf` for what was changed): "
         + ", ".join(f"{n}={v}{u or ''}" for n, v, u in settings), "",
         "## Dataset", "",
         f"Synthetic geometric random walk, seed {ds.get('seed')}, {ds.get('symbols')} symbols x {ds.get('sessions')} sessions = "
         f"{ds.get('rows'):,} rows (log-return N(0.0003, 0.02), open gap N(0, 0.005), high/low wick |N(0, 0.01)|, volume lognormal(13, 1)). "
         "Table `bench.bar_daily`, same columns/constraints as `market.bar_daily` minus foreign keys; primary key (instrument_id, trade_date, source). "
         "Parameters live in `src/market_data/synthetic.py`.", "",
         "## Load and size", "", f"- Load: {ld.get('rows', 0):,} rows in {ld.get('load_seconds')} s = {ld.get('rows_per_second', 0):,} rows/s (COPY, primary-key index maintained during load)",
         f"- Table size: {ld.get('table_bytes', 0) / 2**20:,.0f} MiB; index size: {ld.get('index_bytes', 0) / 2**20:,.0f} MiB; total: {ld.get('total_bytes', 0) / 2**20:,.0f} MiB", "",
         "## Query latency (200 random queries per workload)", "",
         "| Workload | Run | p50 ms | p95 ms | p99 ms | mean ms |", "|---|---|---|---|---|---|"]
    for label, r in (("cold (no warm-up, after restart)", cold), ("warm (20 warm-up queries)", warm)):
        if r:
            for w, s in r["workloads"].items():
                L.append(f"| {w} | {label} | {s['p50_ms']} | {s['p95_ms']} | {s['p99_ms']} | {s['mean_ms']} |")
    if not cold:
        L += ["", "_Cold run not recorded: restart PostgreSQL, then run `bench-run --cold`._"]
    L += ["", "## EXPLAIN (ANALYZE, BUFFERS) excerpts (warm run)", ""]
    for w, plan in (warm or {}).get("explain", {}).items():
        idx = "an index scan on the primary key" if "Index" in plan else "no index (sequential scan)"
        L += [f"### {w}: plan uses {idx}", "", "```", plan, "```", ""]
    L += ["## Conclusion", "", "_Write the plain-language conclusion here after reading the table above: "
          "is the primary key enough? Is partitioning or BRIN justified (yes/no, with the numbers that show it)? "
          "What would you test next (concurrency, cold disk, wider IN lists)?_", ""]
    out = config.DOCS_DIR / "03-benchmarks" / "benchmark-01-postgres-daily-bars.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    text = "\n".join(L)
    if out.exists():  # keep the hand-written conclusion and disk line across regenerations
        prev = out.read_text(encoding="utf-8")
        if "## Conclusion" in prev and "_Write the plain-language" not in prev:
            text = text[: text.index("## Conclusion")] + prev[prev.index("## Conclusion"):]
        for line in prev.splitlines():
            if line.startswith("- Disk:") and "not recorded" not in line:
                text = text.replace("- Disk: not recorded automatically (fill in by hand)", line)
    out.write_text(text, encoding="utf-8")
    return out


def index_experiment(conn: psycopg.Connection) -> dict:
    """Task 02_01: effect of a date-leading index on W1-W4, index size/build time, and load throughput.

    Steps: (1) baseline warm run on the existing schema without the index, (2) build the index
    after load (VACUUM ANALYZE first), size it, (3) same-seed warm run, (4) reload into a fresh
    schema with the index present from the start and compare load rows/s with the baseline load.
    Results are saved as JSON (run_baseline2, run_indexed, index_build, load_with_date_index).
    """
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("DROP INDEX IF EXISTS bench.bench_bar_daily_date_idx")
        cur.execute("VACUUM ANALYZE bench.bar_daily")
    conn.autocommit = False
    base = run(conn, "warm", seed=1, save_as="run_baseline2")
    conn.autocommit = True
    with conn.cursor() as cur:
        t0 = time.perf_counter()
        cur.execute(DATE_INDEX_SQL)
        build_s = time.perf_counter() - t0
        cur.execute("VACUUM ANALYZE bench.bar_daily")
        cur.execute("SELECT pg_relation_size('bench.bench_bar_daily_date_idx')")
        idx_bytes = cur.fetchone()[0]
    conn.autocommit = False
    idx = run(conn, "warm", seed=1, save_as="run_indexed")
    _save("index_build", {"build_seconds": round(build_s, 1), "index_bytes": idx_bytes})
    with conn.cursor() as cur:   # keep the indexed copy, then reload with the index present during load
        cur.execute("ALTER SCHEMA bench RENAME TO bench_with_index")
    conn.commit()
    try:
        loaded = load(conn, date_index=True, save_as="load_with_date_index")
    finally:
        with conn.cursor() as cur:
            cur.execute("DROP SCHEMA IF EXISTS bench_with_index CASCADE")
        conn.commit()
    return {"baseline": base["workloads"], "indexed": idx["workloads"], "build_seconds": round(build_s, 1),
            "index_bytes": idx_bytes, "load_with_index": loaded}
