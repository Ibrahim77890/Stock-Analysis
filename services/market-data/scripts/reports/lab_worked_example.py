"""Worked example of the Strategy Lab on real Tiingo data (Sprint 07, task 07_09).

Creates a study on AAPL, runs three rules on the practice years (20/100, 10/50 and 5/25 days, cost 2 basis points,
seed 1, 100 mixed-up histories) and opens the vault with 20/100. Prints the key numbers as JSON.

    .venv/Scripts/python.exe scripts/reports/lab_worked_example.py            print the numbers
    .venv/Scripts/python.exe scripts/reports/lab_worked_example.py --check    compare them with the block in docs/02-domain/lab.md

Each run creates one study in the real database (the vault of a study can be opened only once).
"""

import json
import re
import sys

import psycopg

from market_data.core import config
from market_data.lab import study as lab

DOC = config.DOCS_DIR / "02-domain" / "lab.md"
START = "<!-- worked-example:start -->"
END = "<!-- worked-example:end -->"


def r4(x):
    return None if x is None else round(float(x), 4)


def run_example() -> dict:
    conn = psycopg.connect(config.database_url())
    sid = lab.create_lab_study(conn, "AAPL", name="Worked example")["study_id"]
    first = None
    for fast, slow in ((20, 100), (10, 50), (5, 25)):
        res = lab.run_practice(conn, sid, fast, slow, 2.0, seed=1, n_paths=100)
        first = first or res
    v = lab.open_vault(conn, sid, 20, 100, 2.0)
    conn.close()
    pick = lambda m: {k: r4(m[k]) for k in ("total_return", "cagr", "max_drawdown", "exposure", "trades", "sharpe")}  # noqa: E731
    return {
        "practice_years": first["practice_years"], "ideas_tried_before_vault": v["ideas_tried"],
        "practice_rule_20_100": pick(first["rule"]), "practice_buy_hold": pick(first["buy_hold"]),
        "cost_table_rule_total_return": {str(c["cost_bps"]): r4(c["total_return"]) for c in first["costs"]},
        "luck_fraction_as_good": r4(first["luck"]["fraction_as_good"]),
        "vault_years": v["vault_years"], "vault_rule": pick(v["rule"]), "vault_buy_hold": pick(v["buy_hold"]),
    }


def doc_block() -> dict:
    text = DOC.read_text(encoding="utf-8")
    m = re.search(re.escape(START) + r"\s*```json\s*(.*?)\s*```\s*" + re.escape(END), text, re.S)
    if not m:
        raise SystemExit(f"no worked-example block found in {DOC}")
    return json.loads(m.group(1))


def main() -> int:
    got = run_example()
    if "--check" not in sys.argv:
        print(json.dumps(got, indent=2))
        return 0
    want = doc_block()
    if got == want:
        print("lab.md worked example matches a fresh run")
        return 0
    print("MISMATCH between docs/02-domain/lab.md and a fresh run")
    for k in sorted(set(got) | set(want)):
        if got.get(k) != want.get(k):
            print(f"  {k}: doc={want.get(k)} fresh={got.get(k)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
