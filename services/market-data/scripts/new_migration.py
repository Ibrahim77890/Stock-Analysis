#!/usr/bin/env python
"""Create the next numbered Alembic migration.

Usage (from services/market-data):
    uv run poe migration-new create instrument table
    python scripts/new_migration.py "create instrument table"

Produces migrations/versions/NNNN_<slug>.py where NNNN is the highest existing
number + 1 (0001, 0002, ...). Alembic links it to the current head
automatically, so the history stays a single line.
"""

import re
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
VERSIONS_DIR = PROJECT_DIR / "migrations" / "versions"
NUMBERED = re.compile(r"^(\d{4})_.+\.py$")


def next_revision_id() -> str:
    numbers = [
        int(m.group(1))
        for path in VERSIONS_DIR.glob("*.py")
        if (m := NUMBERED.match(path.name))
    ]
    return f"{max(numbers, default=0) + 1:04d}"


def main(argv: list[str]) -> int:
    message = " ".join(argv).strip()
    if not message:
        print("Usage: new_migration.py <message words>", file=sys.stderr)
        return 2

    rev_id = next_revision_id()
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "revision", "-m", message, "--rev-id", rev_id],
        cwd=PROJECT_DIR,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
