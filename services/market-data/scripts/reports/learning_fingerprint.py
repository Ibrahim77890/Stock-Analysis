"""Prints a reproducibility fingerprint of the learning loop for the database in DATABASE_URL (task 06_13).

Creates one seeded generated episode and one seeded real (Tiingo) episode, makes three guesses at day 60, advances 10 days
and prints: a sha256 of each episode's blind bars and the Brier score of the generated episode. The same seeds must give
the same output on any database built from the same raw files (see scripts/db/fresh_db_learning.py).
Usage: python scripts/reports/learning_fingerprint.py
"""

import hashlib
import json

import psycopg

from market_data.core import config
from market_data.learning import episode as ep


def digest(rows) -> str:
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


def main() -> None:
    with psycopg.connect(config.database_url()) as conn:
        out = {}
        for name, kind, seed in (("generated", "synthetic", 123), ("real", "real", 5)):
            e = ep.create_episode(conn, kind, n_bars=120, initial_visible=60, seed=seed)
            eid = e["episode_id"]
            for h, p in ((1, 0.6), (5, 0.7), (10, 0.4)):
                ep.add_prediction(conn, eid, h, p)
            ep.advance_episode(conn, eid, 10)
            score = ep.episode_score(conn, eid, n_perm=1000)
            out[name] = {"blind_bars_sha256": digest(ep.episode_bars(conn, eid)), "bars": len(ep.episode_bars(conn, eid)),
                         "brier": round(score["brier"], 12), "luck_probability": score["luck"]["luck_probability"],
                         "outcomes": [p["outcome"] for p in ep.list_predictions(conn, eid)]}
        print(json.dumps(out, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
