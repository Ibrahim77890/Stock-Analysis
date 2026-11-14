"""Back up the learner and research data (schemas `app` and `research`; never `market`, which holds licensed vendor data).

    python scripts/ops/backup.py                 # writes data/backups/marketlab-YYYYMMDD-HHMMSS.dump (git-ignored)
    python scripts/ops/backup.py --restore-check # also restores it into a scratch database and compares every table

Needs PostgreSQL's pg_dump and pg_restore (found on PATH or in the default install folders) and DATABASE_URL (from .env).
The check restores into a scratch database named marketlab_restore_check, never into the real one, and drops it afterwards.
What is NOT backed up: schema `market` (prices, rebuilt from the vendors) and the git-ignored `.env`.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg

ROOT = Path(__file__).resolve().parents[2]
BACKUPS = ROOT / "data" / "backups"
SCHEMAS = ("app", "research")
SCRATCH = "marketlab_restore_check"


def load_env() -> None:
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"'))


def tool(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    for pattern in (r"C:\Program Files\PostgreSQL\*\bin\%s.exe" % name, "/usr/lib/postgresql/*/bin/" + name, "/opt/homebrew/opt/postgresql*/bin/" + name):
        hits = sorted(glob.glob(pattern))
        if hits:
            return hits[-1]
    raise SystemExit(f"{name} was not found. Install the PostgreSQL client tools or add them to PATH.")


def with_db(url: str, db: str) -> str:
    return urlunparse(urlparse(url)._replace(path=f"/{db}"))


def backup(url: str) -> Path:
    BACKUPS.mkdir(parents=True, exist_ok=True)
    out = BACKUPS / f"marketlab-{time.strftime('%Y%m%d-%H%M%S')}.dump"
    cmd = [tool("pg_dump"), "--format=custom", "--no-owner", "--no-privileges", f"--file={out}", *[f"--schema={s}" for s in SCHEMAS], url]
    t0 = time.time()
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit("The backup failed: " + r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "The backup failed.")
    print(f"backup written: {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} KB, {time.time() - t0:.1f} s)")
    return out


def check_readable(dump: Path) -> None:
    r = subprocess.run([tool("pg_restore"), "--list", str(dump)], capture_output=True, text=True)
    if r.returncode != 0 or "market." in r.stdout:
        raise SystemExit("This backup file is damaged or holds the wrong schemas. Do not use it.")


def table_fingerprints(url: str) -> dict[str, tuple[int, str]]:
    out = {}
    with psycopg.connect(url) as c:
        tables = c.execute("SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = ANY(%s) AND table_type = 'BASE TABLE' "
                           "AND table_name NOT LIKE 'pgmigrations%%' AND table_name <> 'alembic_version' ORDER BY 1, 2", (list(SCHEMAS),)).fetchall()
        for s, t in tables:
            n = c.execute(f'SELECT count(*) FROM "{s}"."{t}"').fetchone()[0]
            rows = c.execute(f'SELECT x::text FROM "{s}"."{t}" x').fetchall()
            h = hashlib.sha256("\n".join(sorted(r[0] for r in rows)).encode()).hexdigest()
            out[f"{s}.{t}"] = (n, h)
    return out


def restore_check(url: str, dump: Path) -> int:
    check_readable(dump)
    admin = with_db(url, "postgres")
    scratch = with_db(url, SCRATCH)
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {SCRATCH} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {SCRATCH}")
    try:
        env = {**os.environ, "DATABASE_URL": scratch}
        steps = [([sys.executable, "-m", "alembic", "upgrade", "head"], ROOT / "services" / "market-data"),
                 (["node", str(ROOT / "apps/api/node_modules/node-pg-migrate/bin/node-pg-migrate.js"), "up", "-m", "migrations", "--migrations-schema", "app",
                   "--migrations-table", "pgmigrations", "--create-migrations-schema", "--database-url-var", "DATABASE_URL"], ROOT / "apps" / "api")]
        for cmd, cwd in steps:
            r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True)
            if r.returncode != 0:
                print("setting up the scratch database failed:", r.stderr.strip()[-300:])
                return 1
        with psycopg.connect(scratch, autocommit=True) as c:
            c.execute("TRUNCATE app.pgmigrations RESTART IDENTITY")   # the dump brings its own migration history back
        r = subprocess.run([tool("pg_restore"), "--data-only", "--disable-triggers", "--no-owner", f"--dbname={scratch}", str(dump)], capture_output=True, text=True)
        if r.returncode != 0:
            print("the restore failed:", r.stderr.strip()[-300:])
            return 1
        a, b = table_fingerprints(url), table_fingerprints(scratch)
        bad = [k for k in a if a[k] != b.get(k)]
        extra = [k for k in b if k not in a]
        print(f"compared {len(a)} tables: " + ("all row counts and contents are equal" if not bad and not extra else f"DIFFERENT: {bad + extra}"))
        for k in sorted(a)[:40]:
            print(f"  {k}: {a[k][0]} rows")
        return 0 if not bad and not extra else 1
    finally:
        with psycopg.connect(admin, autocommit=True) as c:
            c.execute(f"DROP DATABASE IF EXISTS {SCRATCH} WITH (FORCE)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--restore-check", action="store_true")
    ap.add_argument("--file", help="check this existing dump instead of making a new one")
    args = ap.parse_args()
    load_env()
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is not set (add it to .env; see .env.example).")
    dump = Path(args.file) if args.file else backup(url)
    if args.restore_check or args.file:
        return restore_check(url, dump)
    return 0


if __name__ == "__main__":
    sys.exit(main())
