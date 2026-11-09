"""Task 05_09 step 4: rebuild everything on an EMPTY database from the local raw files (no network, no keys) and
regenerate the long-window page, then compare it with the committed page.

Usage (from services/market-data):  python scripts/db/fresh_db_repro.py [--keep]
Creates database `marketlab_fresh` on the same server as DATABASE_URL (dropped first if it exists), runs
migrate -> verify -> load (alpaca) -> tiingo-load -> fred-load -> quality (both sources) -> reconcile -> page,
then diffs the page against docs/02-domain/long-window-example.md ignoring the 'generated' and 'Timing' lines.
"""

import difflib
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import psycopg

PROJECT = Path(__file__).resolve().parents[2]
PY = sys.executable
FRESH = "marketlab_fresh"


def main() -> int:
    from dotenv import load_dotenv

    load_dotenv(PROJECT.parents[1] / ".env")
    real = urlparse(os.environ["DATABASE_URL"])
    admin = urlunparse(real._replace(path="/postgres"))
    fresh = urlunparse(real._replace(path=f"/{FRESH}"))
    with psycopg.connect(admin, autocommit=True) as c:
        c.execute(f"DROP DATABASE IF EXISTS {FRESH} WITH (FORCE)")
        c.execute(f"CREATE DATABASE {FRESH}")
    env = {**os.environ, "DATABASE_URL": fresh}
    page = PROJECT.parents[1] / "data" / "reports" / "long-window-example.fresh.md"

    def run(*args, check=True):
        print("$", *args, flush=True)
        r = subprocess.run([PY, *args], cwd=PROJECT, env=env, capture_output=True, text=True)
        tail = (r.stdout or "").strip().splitlines()[-2:]
        print("   ", *tail, sep="\n    ")
        if check and r.returncode != 0:
            print(r.stderr[-1500:])
            raise SystemExit(r.returncode)
        return r

    run("-m", "alembic", "upgrade", "head")
    run("-m", "market_data.cli", "verify")
    run("-m", "market_data.cli", "load")
    run("-m", "market_data.cli", "tiingo-load")
    run("-m", "market_data.cli", "fred-load")
    run("-m", "market_data.cli", "quality", "--run")
    run("-m", "market_data.cli", "quality", "--run", "--source", "tiingo")
    run("-m", "market_data.cli", "reconcile")
    run("scripts/reports/long_window_example.py", str(page))

    def norm(text: str) -> list[str]:
        return [l for l in text.splitlines() if not l.startswith("# Long-window") and not l.startswith("Timing")]

    committed = PROJECT.parents[1] / "docs" / "02-domain" / "long-window-example.md"
    a, b = norm(committed.read_text(encoding="utf-8")), norm(page.read_text(encoding="utf-8"))
    diff = list(difflib.unified_diff(a, b, "committed", "fresh", lineterm="", n=0))
    print(f"lines compared: {len(a)} vs {len(b)}; differing lines: {len(diff)}")
    print("\n".join(diff[:40]))
    if "--keep" not in sys.argv:
        with psycopg.connect(admin, autocommit=True) as c:
            c.execute(f"DROP DATABASE IF EXISTS {FRESH} WITH (FORCE)")
    return 0 if not diff else 1


if __name__ == "__main__":
    sys.exit(main())
