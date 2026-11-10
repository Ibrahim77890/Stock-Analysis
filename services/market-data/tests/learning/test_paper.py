import os
import subprocess
import sys

import psycopg
import pytest
from fastapi.testclient import TestClient

from market_data.api import app, get_conn
from market_data.core.config import PROJECT_DIR
from market_data.learning import episode as ep
from market_data.learning import paper
from tests.learning.conftest import identity_findings

KEY = "key-%06d"


def new(db, **kw):
    return ep.create_episode(db, "synthetic", 120, 60, 5, **kw)["episode_id"]


def closes(db, eid):
    return [b["close"] for b in ep.episode_bars(db, eid)]


def test_decision_is_pending_until_the_next_day_is_revealed_then_marked_with_cost(db):
    eid = new(db)
    d = paper.record_decision(db, eid, "long", "Trend looks up.", KEY % 1, 10)
    assert d["created"] and d["day"] == 60 and d["status"] == "pending" and d["result"] is None
    ep.advance_episode(db, eid, 1)
    j = paper.journal(db, eid)["decisions"][0]
    c = closes(db, eid)
    assert j["status"] == "marked" and j["days_marked"] == 1
    assert j["result"] == pytest.approx((1 - 0.0010) * (c[60] / c[59]) - 1, abs=1e-12)


def test_flat_earns_nothing_and_pays_no_cost_when_the_stance_does_not_change(db):
    eid = new(db)
    paper.record_decision(db, eid, "flat", "Waiting.", KEY % 1)
    ep.advance_episode(db, eid, 3)
    assert paper.journal(db, eid)["decisions"][0]["result"] == 0.0


def test_same_client_key_stores_one_row_and_is_not_created_twice(db):
    eid = new(db)
    a = paper.record_decision(db, eid, "long", "Up.", KEY % 1)
    b = paper.record_decision(db, eid, "long", "Up.", KEY % 1)
    assert a["created"] and not b["created"] and a["decision_id"] == b["decision_id"]
    assert len(paper.journal(db, eid)["decisions"]) == 1


def test_a_second_decision_for_the_same_day_is_refused(db):
    eid = new(db)
    paper.record_decision(db, eid, "long", "Up.", KEY % 1)
    with pytest.raises(ep.InvalidRequest, match="already recorded"):
        paper.record_decision(db, eid, "flat", "Changed my mind.", KEY % 2)


@pytest.mark.parametrize("kw,msg", [({"stance": "short"}, "stance"), ({"reason": "  "}, "reason"), ({"reason": "x" * 281}, "reason"),
                                    ({"client_key": "abc"}, "client_key"), ({"cost_bps": 51}, "cost_bps"), ({"cost_bps": -1}, "cost_bps")])
def test_bad_input_is_refused(db, kw, msg):
    eid = new(db)
    args = {"stance": "long", "reason": "ok", "client_key": KEY % 1, "cost_bps": 2.0, **kw}
    with pytest.raises(ep.InvalidRequest, match=msg):
        paper.record_decision(db, eid, args["stance"], args["reason"], args["client_key"], args["cost_bps"])


def test_a_revealed_episode_takes_no_decision_but_the_journal_is_readable(db):
    eid = new(db)
    paper.record_decision(db, eid, "long", "Up.", KEY % 1)
    ep.reveal(db, eid)
    with pytest.raises(ep.EpisodeClosed):
        paper.record_decision(db, eid, "flat", "Late.", KEY % 2)
    assert len(paper.journal(db, eid)["decisions"]) == 1


def test_unknown_episode(db):
    with pytest.raises(ep.EpisodeNotFound):
        paper.journal(db, "nope")


def test_append_only_the_database_refuses_update_and_delete(db):
    eid = new(db)
    paper.record_decision(db, eid, "long", "Up.", KEY % 1)
    for sql in ("UPDATE research.paper_decision SET stance = 'flat'", "DELETE FROM research.paper_decision"):
        with pytest.raises(psycopg.errors.RaiseException, match="append-only"):
            with db.cursor() as cur:
                cur.execute(sql)
        db.rollback()
    assert len(paper.journal(db, eid)["decisions"]) == 1


def test_results_use_only_revealed_days_truncation(db):
    """A decision's result with the next decision already placed is the same however far the episode goes later."""
    eid = new(db)
    paper.record_decision(db, eid, "long", "Up.", KEY % 1)
    ep.advance_episode(db, eid, 5)
    paper.record_decision(db, eid, "flat", "Out.", KEY % 2)
    first_at_65 = paper.journal(db, eid)["decisions"][0]
    ep.advance_episode(db, eid, 20)
    first_at_85 = paper.journal(db, eid)["decisions"][0]
    assert first_at_65 == first_at_85 and first_at_65["days_marked"] == 5


def test_totals_reconcile_with_the_rows(db):
    eid = new(db)
    for i, st in enumerate(["long", "flat", "long", "long", "flat"]):
        paper.record_decision(db, eid, st, f"reason {i}", KEY % i, 5)
        ep.advance_episode(db, eid, 3)
    j = paper.journal(db, eid)
    growth = 1.0
    for d in j["decisions"]:
        growth *= 1 + d["result"]
    assert j["totals"]["growth"] == pytest.approx(growth - 1, abs=1e-12)
    assert j["totals"]["decisions"] == len(j["decisions"]) == 5 and j["totals"]["marked"] + j["totals"]["pending"] == 5


def test_decision_limit_per_episode(db, monkeypatch):
    monkeypatch.setattr(paper, "MAX_DECISIONS", 3)
    eid = new(db)
    for i in range(3):
        paper.record_decision(db, eid, "long", "x", KEY % i)
        ep.advance_episode(db, eid, 1)
    with pytest.raises(ep.InvalidRequest, match="at most 3"):
        paper.record_decision(db, eid, "long", "x", KEY % 9)


def test_migration_0013_up_down_up(test_db_url):
    env = {**os.environ, "DATABASE_URL": test_db_url}

    def alembic(*a):
        return subprocess.run([sys.executable, "-m", "alembic", *a], cwd=PROJECT_DIR, env=env, capture_output=True, text=True, check=True).stdout

    def tables():
        with psycopg.connect(test_db_url) as c, c.cursor() as cur:
            cur.execute("SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema IN ('market','research') ORDER BY 1")
            return [r[0] for r in cur.fetchall()]

    before = tables()
    assert "research.paper_decision" in before
    alembic("downgrade", "0012")
    assert "research.paper_decision" not in tables()
    alembic("upgrade", "head")
    assert tables() == before


# ---------------------------------------------------------------- HTTP layer

@pytest.fixture
def client(db):
    app.dependency_overrides[get_conn] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture
def client_real(db_real):
    app.dependency_overrides[get_conn] = lambda: db_real
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_every_function_has_an_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    assert "get" in paths["/episodes/{episode_id}/indicators"]
    assert "post" in paths["/episodes/{episode_id}/decisions"] and "get" in paths["/episodes/{episode_id}/decisions"]


def test_indicator_endpoint_shows_only_visible_days_and_grows_after_advance(client):
    eid = client.post("/episodes", json={"kind": "synthetic", "n_bars": 120, "initial_visible": 60, "seed": 5}).json()["episode_id"]
    a = client.get(f"/episodes/{eid}/indicators", params={"name": "sma", "window": 20}).json()
    assert a["day"] == 60 and a["values"][0]["day"] == 20 and a["values"][-1]["day"] == 60 and len(a["values"]) == 41
    client.post(f"/episodes/{eid}/advance", json={"n": 5})
    b = client.get(f"/episodes/{eid}/indicators", params={"name": "sma", "window": 20}).json()
    assert [v for v in b["values"] if v["day"] <= 60] == a["values"] and b["values"][-1]["day"] == 65
    r = client.get(f"/episodes/{eid}/indicators", params={"name": "rsi", "window": 14}).json()
    assert r["values"][0]["day"] == 15 and all(0 <= v["value"] <= 100 for v in r["values"])


def test_indicator_endpoint_bad_input_and_unknown_episode(client):
    eid = client.post("/episodes", json={"kind": "synthetic", "n_bars": 120, "initial_visible": 60, "seed": 5}).json()["episode_id"]
    assert client.get(f"/episodes/{eid}/indicators", params={"name": "macd", "window": 20}).status_code == 422
    assert client.get(f"/episodes/{eid}/indicators", params={"name": "sma", "window": 1}).status_code == 422
    assert client.get(f"/episodes/{eid}/indicators", params={"name": "sma", "window": 201}).status_code == 422
    assert client.get("/episodes/nope/indicators", params={"name": "sma", "window": 20}).status_code == 404


def test_paper_endpoints_idempotent_and_errors(client):
    eid = client.post("/episodes", json={"kind": "synthetic", "n_bars": 120, "initial_visible": 60, "seed": 5}).json()["episode_id"]
    body = {"stance": "long", "reason": "Up.", "client_key": "abcdefgh1", "cost_bps": 2}
    a, b = client.post(f"/episodes/{eid}/decisions", json=body), client.post(f"/episodes/{eid}/decisions", json=body)
    assert a.status_code == b.status_code == 200 and a.json()["created"] and not b.json()["created"]
    assert client.post(f"/episodes/{eid}/decisions", json={**body, "client_key": "abcdefgh2"}).status_code == 422
    assert client.post(f"/episodes/{eid}/decisions", json={**body, "stance": "short"}).status_code == 422
    assert client.get("/episodes/nope/decisions").status_code == 404
    client.post(f"/episodes/{eid}/reveal")
    assert client.post(f"/episodes/{eid}/decisions", json={**body, "client_key": "abcdefgh3"}).status_code == 409
    assert len(client.get(f"/episodes/{eid}/decisions").json()["decisions"]) == 1


def test_no_identity_in_any_indicator_or_paper_reply_of_an_open_real_episode(client_real):
    c = client_real
    eid = c.post("/episodes", json={"kind": "real", "n_bars": 120, "initial_visible": 60, "seed": 3}).json()["episode_id"]
    replies = []
    for k in range(4):
        for name in ("sma", "ema", "rsi"):
            replies.append(c.get(f"/episodes/{eid}/indicators", params={"name": name, "window": 14}).json())
        replies.append(c.post(f"/episodes/{eid}/decisions", json={"stance": "long" if k % 2 else "flat", "reason": "Neutral note.", "client_key": f"key-{k}-abcdef", "cost_bps": 2}).json())
        replies.append(c.get(f"/episodes/{eid}/decisions").json())
        c.post(f"/episodes/{eid}/advance", json={"n": 3})
    assert identity_findings(replies) == []
    planted = {"values": [{"day": 1, "value": 1}], "symbol": "AAPL"}
    assert identity_findings(planted) != []   # the scan really finds a leak (negative)


def test_token_is_required_when_configured(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-token-for-test")
    assert client.get("/episodes/x/decisions").status_code == 401
    assert client.get("/episodes/x/indicators", params={"name": "sma"}).status_code == 401
    assert client.get("/episodes/x/decisions", headers={"X-Internal-Token": "secret-token-for-test"}).status_code == 404
