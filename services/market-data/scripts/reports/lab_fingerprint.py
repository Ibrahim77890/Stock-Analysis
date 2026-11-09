"""Reproducibility fingerprint of the Strategy Lab for the database in DATABASE_URL (Sprint 07, tasks 07_08 and 07_09).

For 5 symbols x 4 rules it creates a study, runs the rules on the practice years (cost 2 bps, seed 1, 50 mixed-up histories),
opens the vault with the first rule, and prints one sha256 over every practice and vault result (without the study ids and
the 'counted' flags). The same raw files must give the same hash on any database (see scripts/db/fresh_db_lab.py).
Each call creates 5 studies. Usage: python scripts/reports/lab_fingerprint.py
"""

import hashlib
import json

import psycopg

from market_data.core import config
from market_data.lab import study as lab

SYMBOLS = ("AAPL", "MSFT", "KO", "JPM", "XOM")
RULES = ((20, 100), (10, 50), (5, 25), (50, 200))


def main() -> None:
    parts = []
    with psycopg.connect(config.database_url()) as conn:
        for sym in SYMBOLS:
            sid = lab.create_lab_study(conn, sym)["study_id"]
            for fast, slow in RULES:
                r = lab.run_practice(conn, sid, fast, slow, 2.0, seed=1, n_paths=50)
                parts.append({k: r[k] for k in ("symbol", "params", "rule", "buy_hold", "growth", "yearly", "costs", "luck", "config_hash", "trial_count")})
            v = lab.open_vault(conn, sid, *RULES[0], 2.0)
            parts.append({k: v[k] for k in ("params", "rule", "buy_hold", "growth", "yearly", "practice", "ideas_tried")})
    blob = json.dumps(parts, sort_keys=True, default=str)
    print(json.dumps({"results": len(parts), "sha256": hashlib.sha256(blob.encode()).hexdigest()}, indent=2))


if __name__ == "__main__":
    main()
