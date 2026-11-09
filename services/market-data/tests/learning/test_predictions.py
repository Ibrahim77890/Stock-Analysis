import random

import polars as pl
import psycopg
import pytest

from market_data.learning import episode as ep
from market_data.market.synthetic import episode_series


def make(db, seed=7, n_bars=120, initial=60):
    return ep.create_episode(db, "synthetic", n_bars=n_bars, initial_visible=initial, seed=seed)["episode_id"]


def closes_of(db, eid):
    row = ep._get(db, eid)
    return episode_series(row["seed"], row["n_bars"], row["synthetic_vol"])["close"].to_list()


def test_hand_computed_resolution_at_the_right_bar(db):
    eid = make(db)
    closes = closes_of(db, eid)
    p = ep.add_prediction(db, eid, 5, 0.7)
    assert p["day"] == 60 and p["status"] == "pending" and p["created"] is True
    ep.advance_episode(db, eid, 4)                                     # day 64: still waiting
    assert ep.list_predictions(db, eid)[0]["status"] == "pending"
    ep.advance_episode(db, eid, 1)                                     # day 65: the answer bar has arrived
    r = ep.list_predictions(db, eid)[0]
    expected = 1 if closes[64] > closes[59] else 0                     # day 65 vs day 60 (1-based days)
    assert r["status"] == "resolved" and r["outcome"] == expected


def test_database_refuses_edits_and_deletes(db):
    eid = make(db)
    ep.add_prediction(db, eid, 1, 0.6)
    with db.cursor() as cur:
        cur.execute("SELECT prediction_id FROM research.prediction")
        pid = cur.fetchone()[0]
    attempts = [
        "UPDATE research.prediction SET p_up = 0.5 WHERE prediction_id = %s",
        "UPDATE research.prediction SET horizon = 5 WHERE prediction_id = %s",
        "UPDATE research.prediction SET made_at = 61 WHERE prediction_id = %s",
        "DELETE FROM research.prediction WHERE prediction_id = %s",
        "UPDATE research.prediction SET status = 'resolved' WHERE prediction_id = %s",     # resolved needs an outcome
        "UPDATE research.prediction SET status = 'pending', outcome = 1 WHERE prediction_id = %s",
    ]
    for sql in attempts:
        with pytest.raises(psycopg.errors.RaiseException):
            with db.cursor() as cur:
                cur.execute(sql, (pid,))
        db.rollback()
    with db.cursor() as cur:       # setting the outcome of a pending row works exactly once
        cur.execute("UPDATE research.prediction SET outcome = 1, status = 'resolved', resolved_at_pos = 61 WHERE prediction_id = %s", (pid,))
    db.commit()
    for sql in ("UPDATE research.prediction SET outcome = 0 WHERE prediction_id = %s",
                "UPDATE research.prediction SET status = 'void', outcome = NULL WHERE prediction_id = %s"):
        with pytest.raises(psycopg.errors.RaiseException):
            with db.cursor() as cur:
                cur.execute(sql, (pid,))
        db.rollback()


def test_resolution_never_reads_beyond_the_cursor_fuzz(db, monkeypatch):
    seen = []
    real_frame = ep._frame

    def spy(conn, row, upto):
        seen.append((row["episode_id"], upto))
        return real_frame(conn, row, upto)

    monkeypatch.setattr(ep, "_frame", spy)
    rng = random.Random(2)
    for i in range(50):
        eid = make(db, seed=i, n_bars=rng.choice([100, 150, 250]))
        for _ in range(rng.randint(1, 4)):
            try:
                ep.add_prediction(db, eid, rng.choice([1, 5, 10]), round(rng.uniform(0.05, 0.95), 4))
            except ep.InvalidRequest:
                pass
            seen.clear()
            day = ep.advance_episode(db, eid, rng.randint(1, 20))["day"]
            assert all(u <= day for e, u in seen if e == eid)       # no bar position beyond the new cursor was read


def test_resolution_equals_resolution_on_data_known_at_the_cursor(db):
    eid = make(db, seed=31, n_bars=200)
    ep.add_prediction(db, eid, 10, 0.5)
    ep.advance_episode(db, eid, 10)
    full = closes_of(db, eid)
    r = ep.list_predictions(db, eid)[0]
    assert r["outcome"] == (1 if full[69] > full[59] else 0)


def test_idempotent_double_submit_and_separate_horizons(db):
    eid = make(db)
    a = ep.add_prediction(db, eid, 5, 0.7)
    b = ep.add_prediction(db, eid, 5, 0.9)                     # same day and horizon: the first one stays
    assert a["prediction_id"] == b["prediction_id"] and b["created"] is False and b["p_up"] == 0.7
    c = ep.add_prediction(db, eid, 1, 0.4)
    assert c["created"] is True and c["prediction_id"] != a["prediction_id"]
    assert len(ep.list_predictions(db, eid)) == 2


@pytest.mark.parametrize("horizon,p", [(3, 0.5), (5, 0.0), (5, 1.0), (5, 0.005), (5, 0.995), (5, 0.12345)])
def test_rejections(db, horizon, p):
    eid = make(db)
    with pytest.raises(ep.InvalidRequest):
        ep.add_prediction(db, eid, horizon, p)


def test_answer_bar_beyond_the_end_is_rejected_and_unknown_or_revealed_episodes(db):
    eid = make(db, n_bars=60, initial=55)
    with pytest.raises(ep.InvalidRequest):
        ep.add_prediction(db, eid, 10, 0.5)
    ep.add_prediction(db, eid, 5, 0.5)                          # 55 + 5 = 60 is the last bar: allowed
    ep.reveal(db, eid)
    with pytest.raises(ep.EpisodeClosed):
        ep.add_prediction(db, eid, 1, 0.5)
    with pytest.raises(ep.EpisodeNotFound):
        ep.add_prediction(db, "missing", 1, 0.5)


def test_reveal_voids_pending_and_counts_reconcile_in_every_state(db):
    rng = random.Random(6)
    for i in range(20):
        eid = make(db, seed=100 + i, n_bars=250)
        for _ in range(rng.randint(1, 5)):
            ep.add_prediction(db, eid, rng.choice([1, 5, 10]), round(rng.uniform(0.05, 0.95), 4))
            ep.advance_episode(db, eid, rng.randint(1, 8))
            c = ep.counts(db, eid)
            assert c["resolved"] + c["void"] + c["pending"] == c["total"]
        r = ep.reveal(db, eid)["counts"]
        assert r["pending"] == 0 and r["resolved"] + r["void"] == r["total"]
        assert all(p["status"] in ("resolved", "void") for p in ep.list_predictions(db, eid))


def test_ties_count_as_not_up(db, monkeypatch):
    eid = make(db)
    flat = pl.DataFrame({"open": [10.0] * 120, "high": [10.0] * 120, "low": [10.0] * 120, "close": [10.0] * 120, "volume": [1] * 120})
    monkeypatch.setattr(ep, "_frame", lambda conn, row, upto: flat.head(upto))
    ep.add_prediction(db, eid, 1, 0.9)
    ep.advance_episode(db, eid, 1)
    assert ep.list_predictions(db, eid)[0]["outcome"] == 0


def test_outcomes_only_visible_when_resolved(db):
    eid = make(db)
    ep.add_prediction(db, eid, 10, 0.5)
    assert ep.list_predictions(db, eid)[0]["outcome"] is None
