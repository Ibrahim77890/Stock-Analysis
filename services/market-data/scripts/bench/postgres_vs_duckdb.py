"""Sprint 10, task 10_06: five fixed queries on PostgreSQL and on DuckDB reading Parquet, with an equality check.

    .venv/Scripts/python.exe scripts/bench/postgres_vs_duckdb.py

Reads the real database (read only). Writes Parquet files under data/parquet/ (git-ignored: vendor data must not be shared) and
docs/03-benchmarks/benchmark-07-postgres-vs-duckdb.md. Each query: 1 warm-up and 20 timed runs on each engine; p50, p95, max.
The two engines must return equal answers; otherwise the script stops. A deliberately wrong query is checked first (negative test).
"""

from __future__ import annotations

import os
import platform
import statistics
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

import duckdb
import psycopg
import pyarrow as pa
import pyarrow.parquet as pq

from market_data.core import config

ROOT = config.REPO_ROOT
OUT_DIR = ROOT / "data" / "parquet"
RUNS = 20
SOURCE = "tiingo"
ONE_DATE = date(2021, 12, 31)


def export_parquet(conn: psycopg.Connection) -> dict:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with conn.cursor() as cur:
        cur.execute("SELECT i.symbol, b.instrument_id, b.trade_date, b.open::float8, b.high::float8, b.low::float8, b.close::float8, b.volume "
                    "FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE b.source = %s ORDER BY b.instrument_id, b.trade_date", (SOURCE,))
        rows = cur.fetchall()
        cols = ["symbol", "instrument_id", "trade_date", "open", "high", "low", "close", "volume"]
        pq.write_table(pa.table({c: [r[i] for r in rows] for i, c in enumerate(cols)}), OUT_DIR / "bars_tiingo.parquet", compression="zstd")
        cur.execute("SELECT instrument_id, action_type, ex_date, cash_amount::float8 FROM market.corporate_action WHERE source = %s", (SOURCE,))
        acts = cur.fetchall()
        pq.write_table(pa.table({c: [r[i] for r in acts] for i, c in enumerate(["instrument_id", "action_type", "ex_date", "cash_amount"])}),
                       OUT_DIR / "actions_tiingo.parquet", compression="zstd")
    return {"bars": len(rows), "actions": len(acts), "bars_bytes": (OUT_DIR / "bars_tiingo.parquet").stat().st_size,
            "actions_bytes": (OUT_DIR / "actions_tiingo.parquet").stat().st_size}


# Each query: (name, postgres sql, duckdb sql, postgres params). Results are reduced to small comparable tuples.
Q = {
    "Q1 one symbol, ten years": (
        "SELECT count(*), sum(b.close)::float8 FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) "
        "WHERE i.symbol = 'AAPL' AND b.source = %s AND b.trade_date BETWEEN '2012-01-01' AND '2021-12-31'",
        "SELECT count(*), sum(close) FROM read_parquet('{bars}') WHERE symbol = 'AAPL' AND trade_date BETWEEN DATE '2012-01-01' AND DATE '2021-12-31'"),
    "Q2 all symbols on one date": (
        "SELECT count(*), sum(b.close)::float8 FROM market.bar_daily b WHERE b.source = %s AND b.trade_date = '2021-12-31'",
        "SELECT count(*), sum(close) FROM read_parquet('{bars}') WHERE trade_date = DATE '2021-12-31'"),
    "Q3 20-day average for every symbol": (
        "SELECT count(*), sum(a)::float8 FROM (SELECT avg(b.close) OVER (PARTITION BY b.instrument_id ORDER BY b.trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) a, "
        "row_number() OVER (PARTITION BY b.instrument_id ORDER BY b.trade_date) rn FROM market.bar_daily b WHERE b.source = %s) t WHERE rn >= 20",
        "SELECT count(*), sum(a) FROM (SELECT avg(close) OVER (PARTITION BY instrument_id ORDER BY trade_date ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) a, "
        "row_number() OVER (PARTITION BY instrument_id ORDER BY trade_date) rn FROM read_parquet('{bars}')) t WHERE rn >= 20"),
    "Q4 best ten 20-day returns": (
        "SELECT symbol, trade_date, r FROM (SELECT i.symbol, b.trade_date, b.close / lag(b.close, 20) OVER (PARTITION BY b.instrument_id ORDER BY b.trade_date) - 1 AS r "
        "FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE b.source = %s) t WHERE r IS NOT NULL ORDER BY r DESC, symbol, trade_date LIMIT 10",
        "SELECT symbol, trade_date, r FROM (SELECT symbol, trade_date, close / lag(close, 20) OVER (PARTITION BY instrument_id ORDER BY trade_date) - 1 AS r "
        "FROM read_parquet('{bars}')) t WHERE r IS NOT NULL ORDER BY r DESC, symbol, trade_date LIMIT 10"),
    "Q5 bars on corporate-action days": (
        "SELECT a.action_type, count(*), coalesce(sum(a.cash_amount), 0)::float8 FROM market.corporate_action a JOIN market.bar_daily b "
        "ON b.instrument_id = a.instrument_id AND b.trade_date = a.ex_date AND b.source = a.source WHERE a.source = %s GROUP BY a.action_type ORDER BY a.action_type",
        "SELECT a.action_type, count(*), coalesce(sum(a.cash_amount), 0) FROM read_parquet('{actions}') a JOIN read_parquet('{bars}') b "
        "ON b.instrument_id = a.instrument_id AND b.trade_date = a.ex_date GROUP BY a.action_type ORDER BY a.action_type"),
}


def same(a, b, tol=1e-9) -> bool:
    if len(a) != len(b):
        return False
    for ra, rb in zip(a, b):
        if len(ra) != len(rb):
            return False
        for x, y in zip(ra, rb):
            if isinstance(x, (int, float)) and isinstance(y, (int, float)) and not isinstance(x, bool):
                if abs(x - y) > tol * max(1.0, abs(x), abs(y)):
                    return False
            elif x != y:
                return False
    return True


def pct(values: list[float], p: float) -> float:
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def timed(fn, runs=RUNS):
    fn()                                  # warm-up, not counted
    out, last = [], None
    for _ in range(runs):
        t0 = time.perf_counter()
        last = fn()
        out.append((time.perf_counter() - t0) * 1000)
    return last, out


def machine() -> str:
    try:
        git = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    except Exception:  # noqa: BLE001
        git = "unknown"
    mem = ""
    try:
        import ctypes

        class MS(ctypes.Structure):
            _fields_ = [("l", ctypes.c_ulong), ("m", ctypes.c_ulong), ("tp", ctypes.c_ulonglong), ("ap", ctypes.c_ulonglong), ("tpf", ctypes.c_ulonglong),
                        ("apf", ctypes.c_ulonglong), ("tv", ctypes.c_ulonglong), ("av", ctypes.c_ulonglong), ("ae", ctypes.c_ulonglong)]
        ms = MS(); ms.l = ctypes.sizeof(MS); ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(ms)); mem = f", {ms.tp / 2**30:.0f} GB RAM"
    except Exception:  # noqa: BLE001
        pass
    return f"{platform.processor() or platform.machine()} ({os.cpu_count()} threads){mem}, {platform.system()} {platform.release()}, Python {sys.version.split()[0]}, DuckDB {duckdb.__version__}, git {git} (working tree)"


def main() -> int:
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    with psycopg.connect(config.database_url()) as conn:
        conn.read_only = True
        info = export_parquet(conn)
        bars, actions = (OUT_DIR / "bars_tiingo.parquet").as_posix(), (OUT_DIR / "actions_tiingo.parquet").as_posix()
        dd = duckdb.connect()
        rows = []
        pg_version = conn.execute("SHOW server_version").fetchone()[0]

        # negative test: a deliberately wrong DuckDB query must be caught by the equality check
        pg_ok = conn.execute(Q["Q2 all symbols on one date"][0], (SOURCE,)).fetchall()
        wrong = dd.execute("SELECT count(*), sum(close) FROM read_parquet('%s') WHERE trade_date = DATE '2021-12-30'" % bars).fetchall()
        assert not same(pg_ok, wrong), "the equality check failed to catch a wrong query"

        for name, (pg_sql, dd_sql) in Q.items():
            pg_res, pg_t = timed(lambda: conn.execute(pg_sql, (SOURCE,)).fetchall())
            dd_res, dd_t = timed(lambda: dd.execute(dd_sql.format(bars=bars, actions=actions)).fetchall())
            pg_res = [tuple(float(x) if hasattr(x, "as_tuple") else x for x in r) for r in pg_res]
            if not same(pg_res, dd_res):
                print("RESULTS DIFFER", name, pg_res[:3], dd_res[:3])
                return 1
            rows.append((name, pg_t, dd_t, len(pg_res)))
        plan = "\n".join(r[0] for r in conn.execute("EXPLAIN (ANALYZE, BUFFERS) " + Q["Q3 20-day average for every symbol"][0], (SOURCE,)).fetchall())

    lines = ["| Query | Rows returned | PostgreSQL p50 / p95 / max (ms) | DuckDB on Parquet p50 / p95 / max (ms) | Faster at p50 |", "|---|---|---|---|---|"]
    for name, pg_t, dd_t, n in rows:
        a, b = pct(pg_t, 50), pct(dd_t, 50)
        lines.append(f"| {name} | {n} | {a:.1f} / {pct(pg_t, 95):.1f} / {max(pg_t):.1f} | {b:.1f} / {pct(dd_t, 95):.1f} / {max(dd_t):.1f} | "
                     f"{'DuckDB' if b < a else 'PostgreSQL'} ({max(a, b) / max(min(a, b), 0.001):.1f}x) |")
    text = f"""# Benchmark 07: PostgreSQL versus DuckDB on Parquet

Measured {date.today().isoformat()} by `services/market-data/scripts/bench/postgres_vs_duckdb.py`.

**Machine and versions:** {machine()}; PostgreSQL {pg_version} on the same machine.

**Data:** Tiingo daily bars, {info['bars']:,} rows (all stocks), corporate actions {info['actions']:,} rows. Parquet files (zstd) under `data/parquet/` (git-ignored): bars {info['bars_bytes'] / 2**20:.1f} MB, actions {info['actions_bytes'] / 1024:.0f} KB.

**Method:** five fixed queries (in the script). For each engine: one warm-up run, then {RUNS} timed runs; p50, p95 and max. PostgreSQL uses its existing indexes and returns the same small result as DuckDB. DuckDB reads the Parquet files in every run (no cached table). **Both engines returned equal answers for all five queries** (numbers equal within 1e-9; the check was first shown to catch a deliberately wrong query).

{chr(10).join(lines)}

**PostgreSQL plan of the slowest-looking query (Q3), `EXPLAIN (ANALYZE, BUFFERS)`:**

```
{plan}
```

**What this shows:** how long these five queries take on this machine with this data size, warm.

**What this does not show:** many users at once, writes or transactions (DuckDB does not replace them here), a cold cache, other data sizes, a remote database, or the cost of building and refreshing the Parquet files. No target was set before measuring. The result is for these queries only; it does not show that either engine is faster in general.
"""
    out = ROOT / "docs" / "03-benchmarks" / "benchmark-07-postgres-vs-duckdb.md"
    out.write_text(text, encoding="utf-8")
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
