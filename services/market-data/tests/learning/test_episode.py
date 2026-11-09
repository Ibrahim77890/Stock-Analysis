import hashlib
import json
import os
import random
import re
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

from market_data.learning import episode as ep
from tests.conftest import PROJECT_DIR
from tests.learning.conftest import identity_findings

SRC = Path(__file__).resolve().parents[2] / "src" / "market_data"


def digest(rows):
    return hashlib.sha256(json.dumps(rows, sort_keys=True, default=str).encode()).hexdigest()


# ---- migrations

def test_migrations_0010_0011_up_down_up(test_db_url):
    env = {**os.environ, "DATABASE_URL": test_db_url}

    def alembic(*a):
        return subprocess.run([sys.executable, "-m", "alembic", *a], cwd=PROJECT_DIR, env=env, capture_output=True, text=True, check=True).stdout

    def tables():
        with psycopg.connect(test_db_url) as c, c.cursor() as cur:
            cur.execute("SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema IN ('market','research') ORDER BY 1")
            return [r[0] for r in cur.fetchall()]

    before = tables()
    assert "research.episode" in before and "research.prediction" in before
    alembic("downgrade", "0009")
    assert "research.episode" not in tables() and "research.prediction" not in tables()
    alembic("upgrade", "head")
    assert tables() == before and "0012" in alembic("heads")


# ---- synthetic episodes (no market data needed)

def test_same_seed_same_episode_different_seed_different(db):
    a = ep.create_episode(db, "synthetic", seed=11)
    b = ep.create_episode(db, "synthetic", seed=11)
    c = ep.create_episode(db, "synthetic", seed=12)
    assert a["episode_id"] != b["episode_id"]
    da, dbb, dc = (digest(ep.episode_bars(db, x["episode_id"])) for x in (a, b, c))
    assert da == dbb and da != dc


def test_boundary_and_first_close_fuzz_synthetic(db):
    rng = random.Random(4)
    for _ in range(50):
        e = ep.create_episode(db, "synthetic", n_bars=rng.choice([60, 120, 250]), initial_visible=rng.choice([20, 30, 59]), seed=rng.randrange(10**6))
        for _ in range(rng.randint(0, 6)):
            ep.advance_episode(db, e["episode_id"], rng.randint(1, 20))
        pub = ep.get_public(db, e["episode_id"])
        bars = ep.episode_bars(db, e["episode_id"])
        assert len(bars) == pub["day"] <= pub["n_bars"]
        assert bars[0]["close"] == pytest.approx(100.0) and [b["day"] for b in bars] == list(range(1, len(bars) + 1))
        first = pub["initial_visible"]
        assert sum(b["rel_volume"] for b in bars[:first]) / first == pytest.approx(1.0)


def test_advance_limits_and_clamping(db):
    e = ep.create_episode(db, "synthetic", n_bars=60, initial_visible=50, seed=1)
    for bad in (0, 21, -1):
        with pytest.raises(ep.InvalidRequest):
            ep.advance_episode(db, e["episode_id"], bad)
    assert ep.advance_episode(db, e["episode_id"], 20)["day"] == 60          # clamps at n_bars
    assert ep.advance_episode(db, e["episode_id"], 1)["day"] == 60


def test_validation_of_creation(db):
    for kw in ({"kind": "other"}, {"n_bars": 59}, {"n_bars": 501}, {"initial_visible": 19}, {"n_bars": 100, "initial_visible": 100}):
        with pytest.raises(ep.InvalidRequest):
            ep.create_episode(db, **{"kind": "synthetic", **kw})


def test_revealed_episode_refuses_advance_and_missing_is_404(db):
    e = ep.create_episode(db, "synthetic", seed=2)
    ep.reveal(db, e["episode_id"])
    with pytest.raises(ep.EpisodeClosed):
        ep.advance_episode(db, e["episode_id"])
    with pytest.raises(ep.EpisodeNotFound):
        ep.get_public(db, "nope")


def test_explicit_kind_is_shown_and_mixed_kind_appears_after_reveal(db_real):
    db = db_real
    e = ep.create_episode(db, "synthetic", seed=3)
    assert e["kind"] == "synthetic"
    m = ep.create_episode(db, "mixed", seed=3)
    assert "kind" not in m
    ep.reveal(db, m["episode_id"])
    assert "kind" in ep.get_public(db, m["episode_id"])


def test_synthetic_public_state_and_bars_have_no_identity(db):
    e = ep.create_episode(db, "synthetic", seed=9)
    ep.advance_episode(db, e["episode_id"], 5)
    for payload in (ep.get_public(db, e["episode_id"]), {"bars": ep.episode_bars(db, e["episode_id"])}):
        assert identity_findings(payload) == []


# ---- real episodes (a copy of Tiingo AAPL in the throwaway database)

def test_real_episodes_mixed_share_and_determinism(db_real):
    assert ep.create_episode(db_real, "real", seed=5)["kind"] == "real"
    kinds = []
    for seed in range(200):
        e = ep.create_episode(db_real, "mixed", seed=seed)
        assert "kind" not in e and e["kind_requested"] == "mixed"
        with db_real.cursor() as cur:
            cur.execute("SELECT kind FROM research.episode WHERE episode_id = %s", (e["episode_id"],))
            kinds.append(cur.fetchone()[0])
    assert 0.4 <= kinds.count("real") / 200 <= 0.6
    a, b = ep.create_episode(db_real, "real", seed=77), ep.create_episode(db_real, "real", seed=77)
    assert digest(ep.episode_bars(db_real, a["episode_id"])) == digest(ep.episode_bars(db_real, b["episode_id"]))


def test_identity_leak_scan_50_real_episodes(db_real):
    rng = random.Random(8)
    with db_real.cursor() as cur:
        cur.execute("SELECT min(volume) FROM market.bar_daily WHERE source = 'tiingo'")
        min_raw_volume = cur.fetchone()[0]
    for seed in range(50):
        e = ep.create_episode(db_real, "real", seed=seed, n_bars=rng.choice([80, 120, 250]))
        responses = [e]
        p = ep.add_prediction(db_real, e["episode_id"], 1, 0.6)
        for _ in range(rng.randint(0, 4)):
            responses.append(ep.advance_episode(db_real, e["episode_id"], rng.randint(1, 20)))
        responses += [p, {"predictions": ep.list_predictions(db_real, e["episode_id"])}, ep.episode_score(db_real, e["episode_id"], 200)]
        bars = ep.episode_bars(db_real, e["episode_id"])
        responses.append({"bars": bars})
        for r in responses:
            assert identity_findings(r) == [], (seed, identity_findings(r))
        # numbers: no absolute price or volume level (the first close is exactly 100; others never equal a stored raw close)
        assert bars[0]["close"] == pytest.approx(100.0)
        assert max(b["rel_volume"] for b in bars) < min_raw_volume / 10     # relative, never an absolute volume
        first = e["initial_visible"]
        assert sum(b["rel_volume"] for b in bars[:first]) / first == pytest.approx(1.0)
        with db_real.cursor() as cur:
            cur.execute("TRUNCATE research.prediction, research.episode CASCADE")
        db_real.commit()


def test_scale_is_stable_and_causal_for_real_episodes(db_real):
    """First rows do not change when the cursor advances; and deleting all later market data changes nothing."""
    for seed in (1, 2, 3, 4, 5, 6, 7, 8, 9, 10):
        e = ep.create_episode(db_real, "real", seed=seed, n_bars=120, initial_visible=40)
        first_rows = ep.episode_bars(db_real, e["episode_id"])
        pub = ep.advance_episode(db_real, e["episode_id"], 15)
        later = ep.episode_bars(db_real, e["episode_id"])
        assert len(later) == pub["day"]
        for a, b in zip(first_rows, later):
            for k in ("open", "high", "low", "close", "rel_volume"):
                assert b[k] == pytest.approx(a[k], rel=1e-9)
        # causality: remove everything after the cursor date and recompute
        row = ep._get(db_real, e["episode_id"])
        cursor_date = ep._dates(db_real, row)[row["cursor_pos"] - 1]
        with db_real.cursor() as cur:
            cur.execute("DELETE FROM market.bar_daily WHERE trade_date > %s", (cursor_date,))
            cur.execute("DELETE FROM market.corporate_action WHERE ex_date > %s", (cursor_date,))
        truncated = ep.episode_bars(db_real, e["episode_id"])
        db_real.rollback()
        assert truncated == later
        db_real.rollback()


def test_reveal_real_episode_shows_identity_only_after(db_real):
    e = ep.create_episode(db_real, "real", seed=21)
    ep.advance_episode(db_real, e["episode_id"], 3)
    assert identity_findings({"state": ep.get_public(db_real, e["episode_id"])}) == []
    r = ep.reveal(db_real, e["episode_id"])
    assert r["kind"] == "real" and r["identity"]["symbol"] == "AAPL" and r["identity"]["first_date"] < r["identity"]["last_date"]
    assert "internal use only" in r["data_trail"]["licence"]
    assert ep.reveal(db_real, e["episode_id"])["identity"] == r["identity"]       # idempotent


# ---- structure

def test_only_episode_module_touches_the_episode_tables():
    pat = re.compile(r"research\.(episode|prediction)\b")
    offenders = [p.relative_to(SRC).as_posix() for p in SRC.rglob("*.py")
                 if p.relative_to(SRC).as_posix() not in ("learning/episode.py",) and pat.search(p.read_text(encoding="utf-8"))
                 and "migrations" not in p.parts]
    assert offenders == []
