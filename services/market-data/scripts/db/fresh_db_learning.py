"""Task 06_13: rebuild the Python side of the stack on an EMPTY database from the local raw files (no network, no keys),
then check the learning loop gives the same fingerprint as the real database and that the learning tests pass on it.

Usage (from services/market-data):  python scripts/db/fresh_db_learning.py [--keep]
Creates database `marketlab_fresh_learning`; migrates (0001 to 0012), verifies and loads Alpaca, Tiingo and FRED, runs the
fingerprint on the fresh and on the real database and compares them, then runs tests/learning with the fresh database as the
'real' one. The gateway and web steps are listed in sprints/06_current/completed/06_13.md.
"""

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg

PROJECT = Path(__file__).resolve().parents[2]
PY = sys.executable
FRESH = "marketlab_fresh_learning"


def main() -> int:
    from dotenv import load_dotenv

    load_dotenv(PROJECT.parents[1] / ".env")
    real_url = os.environ["DATABASE_URL"]
    parsed = urlparse(real_url)
    admin = urlunparse(parsed._replace(path="/postgres"))
    fresh = urlunparse(parsed._replace(path=f"/{FRESH}"))
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {FRESH} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {FRESH}")
    base = {**os.environ}

    def run(env_url, *args, check=True, extra=None):
        env = {**base, "DATABASE_URL": env_url, **(extra or {})}
        print("$", *args, flush=True)
        r = subprocess.run([PY, *args], cwd=PROJECT, env=env, capture_output=True, text=True)
        tail = (r.stdout or "").strip().splitlines()[-2:]
        print("   " + "\n   ".join(tail))
        if check and r.returncode != 0:
            print(r.stderr[-1500:])
            raise SystemExit(r.returncode)
        return r

    run(fresh, "-m", "alembic", "upgrade", "head")
    heads = run(fresh, "-m", "alembic", "heads").stdout
    assert "0012" in heads, heads
    for cmd in (["verify"], ["load"], ["tiingo-load"], ["fred-load"]):
        run(fresh, "-m", "market_data.cli", *cmd)
    fp_fresh = json.loads(run(fresh, "scripts/reports/learning_fingerprint.py").stdout)
    fp_real = json.loads(run(real_url, "scripts/reports/learning_fingerprint.py").stdout)
    same = fp_fresh == fp_real
    print("fingerprint equal on the real and the fresh database:", same)
    print(json.dumps(fp_fresh, indent=1, sort_keys=True))
    r = run(fresh, "-m", "pytest", "tests/learning", "-q", check=False,
            extra={"TEST_DATABASE_URL": os.environ.get("TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/marketlab_test")})
    ok_tests = r.returncode == 0
    if "--keep" not in sys.argv:
        with psycopg.connect(admin, autocommit=True) as c:
            c.execute(f"DROP DATABASE IF EXISTS {FRESH} WITH (FORCE)")
    return 0 if same and ok_tests else 1


if __name__ == "__main__":
    sys.exit(main())
