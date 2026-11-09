"""Compares numbers written in the documents with the code and the database (Sprint 07, task 07_09). Exit code 1 on any mismatch.

    .venv/Scripts/python.exe scripts/reports/docs_counts_check.py

Checks: (1) the Alembic head named in the docs, (2) the number of Lab routes in the Python OpenAPI against the README row,
(3) the number of eligible stocks in docs/02-domain/lab.md against the database, (4) the glossary size named in the Sprint 07
completion note against app.glossary_term, (5) the Lab routes of the gateway OpenAPI against apps/api/README.md.
"""

import json
import re
import subprocess
import sys
from pathlib import Path

import psycopg

from market_data.core import config
from market_data.lab import study as lab

ROOT = config.REPO_ROOT
problems: list[str] = []


def check(name: str, doc, real) -> None:
    ok = doc == real
    print(("ok   " if ok else "FAIL ") + f"{name}: docs={doc} code={real}")
    if not ok:
        problems.append(name)


def main() -> int:
    # 1. alembic head
    head = re.search(r"\((\d{4})\)|^(\d{4}) ", subprocess.run([sys.executable, "-m", "alembic", "heads"], cwd=config.PROJECT_DIR, capture_output=True, text=True).stdout, re.M)
    head_no = (head.group(1) or head.group(2)) if head else "?"
    dd = (ROOT / "docs/02-domain/data-dictionary.md").read_text(encoding="utf-8")
    newest_doc = max(re.findall(r"migration (\d{4})", dd))
    check("newest migration named in the data dictionary", newest_doc, head_no)

    # 2. Python Lab routes
    spec = json.loads((ROOT / "docs/02-domain/openapi-market-data.json").read_text(encoding="utf-8"))
    py_routes = sum(1 for p, ops in spec["paths"].items() if p.startswith("/lab/") for _ in ops)
    readme = (config.PROJECT_DIR / "README.md").read_text(encoding="utf-8")
    row = next(line for line in readme.splitlines() if line.startswith("| Lab |"))
    listed = len(re.findall(r"`(?:GET|POST)(?:\|GET)? /lab/", row)) + row.count("`POST|GET /lab/studies/{id}/vault`")
    check("Python Lab routes (OpenAPI) versus the README row", listed, py_routes)

    # 3. eligible stocks
    with psycopg.connect(config.database_url()) as conn:
        n_stocks = len(lab.eligible_symbols(conn))
        n_terms = conn.execute("SELECT count(*) FROM app.glossary_term").fetchone()[0]
    lab_md = (ROOT / "docs/02-domain/lab.md").read_text(encoding="utf-8")
    m = re.search(r"today (\d+) symbols", lab_md)
    check("eligible stocks named in lab.md", int(m.group(1)) if m else None, n_stocks)

    # 4. glossary size in the completion note
    note = next((ROOT / "sprints").glob("07_*/completed/07_05.md"), None)
    if note:
        m = re.search(r"the glossary now has (\d+) terms", note.read_text(encoding="utf-8"))
        check("glossary terms named in the 07_05 completion note", int(m.group(1)) if m else None, n_terms)

    # 5. gateway Lab routes
    gw = json.loads((ROOT / "docs/02-domain/openapi-gateway.json").read_text(encoding="utf-8"))
    gw_routes = sum(1 for p, ops in gw["paths"].items() if p.startswith("/lab/") for _ in ops)
    api_readme = (ROOT / "apps/api/README.md").read_text(encoding="utf-8")
    listed_gw = len(re.findall(r"`(?:GET|POST)(?:\|GET)? /lab/[^`]*`", api_readme)) + api_readme.count("`POST|GET /lab/studies`") + api_readme.count("`POST|GET /lab/studies/:id/vault`")
    check("gateway Lab routes (OpenAPI) versus apps/api/README.md", listed_gw, gw_routes)

    print("\nall counts match" if not problems else f"\nMISMATCH: {problems}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
