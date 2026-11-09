import json
import random

import pytest
from fastapi.testclient import TestClient

from market_data.api import app, get_conn
from market_data.learning import episode as ep
from market_data.market.synthetic import episode_series
from tests.learning.conftest import identity_findings


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


def new(client, **kw):
    r = client.post("/episodes", json={"kind": "synthetic", "n_bars": 120, "initial_visible": 60, "seed": 5, **kw})
    assert r.status_code == 200, r.text
    return r.json()["episode_id"]


def test_every_sprint_06_function_has_an_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {"create_episode": ("/episodes", "post"), "get_public": ("/episodes/{episode_id}", "get"),
                "episode_bars": ("/episodes/{episode_id}/bars", "get"), "advance_episode": ("/episodes/{episode_id}/advance", "post"),
                "add_prediction": ("/episodes/{episode_id}/predictions", "post"), "list_predictions": ("/episodes/{episode_id}/predictions", "get"),
                "episode_score": ("/episodes/{episode_id}/score", "get"), "reveal": ("/episodes/{episode_id}/reveal", "post"),
                "get_public_many": ("/episodes/states", "post"), "learning_summary": ("/learning/summary", "get"), "learning_summary_for": ("/learning/summary", "post")}
    for fn, (path, method) in expected.items():
        assert method in paths[path], fn
    assert "Learning" in {t["name"] for t in client.get("/openapi.json").json()["tags"]}


def test_end_to_end_with_hand_computed_brier(client, db):
    eid = new(client)
    row = ep._get(db, eid)
    closes = episode_series(row["seed"], row["n_bars"], row["synthetic_vol"])["close"].to_list()
    plan = [(1, 0.9), (5, 0.7), (10, 0.2)]
    for h, p in plan:
        assert client.post(f"/episodes/{eid}/predictions", json={"horizon": h, "p_up": p}).status_code == 200
    for _ in range(2):
        client.post(f"/episodes/{eid}/advance", json={"n": 10})
    preds = client.get(f"/episodes/{eid}/predictions").json()
    assert preds["counts"] == {"resolved": 3, "void": 0, "pending": 0, "total": 3}
    outcomes = [1 if closes[59 + h] > closes[59] else 0 for h, _ in plan]        # made at day 60
    score = client.get(f"/episodes/{eid}/score", params={"permutations": 200}).json()
    assert score["n"] == 3 and score["brier"] == pytest.approx(sum((p - y) ** 2 for (_, p), y in zip(plan, outcomes)) / 3)
    assert any("too few" in w for w in score["warnings"])
    rev = client.post(f"/episodes/{eid}/reveal").json()
    assert rev["kind"] == "synthetic" and "no market date" in rev["statement"]
    again = client.post(f"/episodes/{eid}/reveal").json()
    assert again == rev
    after = client.get(f"/episodes/{eid}/score", params={"permutations": 200}).json()
    assert after["brier"] == score["brier"] and after["counts"]["resolved"] == 3
    assert client.post(f"/episodes/{eid}/advance", json={"n": 1}).status_code == 409
    assert client.post(f"/episodes/{eid}/predictions", json={"horizon": 1, "p_up": 0.5}).status_code == 409


def test_errors_and_validation(client):
    assert client.get("/episodes/nope").status_code == 404
    assert client.post("/episodes", json={"kind": "other"}).status_code == 422
    assert client.post("/episodes", json={"n_bars": 10}).status_code == 422
    eid = new(client)
    assert client.post(f"/episodes/{eid}/advance", json={"n": 21}).status_code == 422
    assert client.post(f"/episodes/{eid}/predictions", json={"horizon": 3, "p_up": 0.5}).status_code == 422
    assert client.post(f"/episodes/{eid}/predictions", json={"horizon": 5, "p_up": 1.0}).status_code == 422


def test_warning_boundary_29_vs_30_resolved(client):
    eid = new(client, n_bars=150, initial_visible=60, seed=9)
    counts = []
    for i in range(30):
        client.post(f"/episodes/{eid}/predictions", json={"horizon": 1, "p_up": round(0.4 + (i % 5) * 0.1, 1)})
        client.post(f"/episodes/{eid}/advance", json={"n": 1})
        if i + 1 in (29, 30):
            s = client.get(f"/episodes/{eid}/score", params={"permutations": 200}).json()
            counts.append((s["n"], any("too few" in w for w in s["warnings"]), s["enough"]))
    assert counts == [(29, True, False), (30, False, True)]


def test_internal_token_is_enforced_when_set(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-internal-token-for-tests")
    assert client.post("/episodes", json={"kind": "synthetic"}).status_code == 401
    assert client.post("/episodes", json={"kind": "synthetic"}, headers={"X-Internal-Token": "wrong"}).status_code == 401
    ok = client.post("/episodes", json={"kind": "synthetic", "seed": 1}, headers={"X-Internal-Token": "secret-internal-token-for-tests"})
    assert ok.status_code == 200 and "secret-internal-token" not in ok.text
    assert client.get("/learning/summary").status_code == 401
    monkeypatch.delenv("INTERNAL_API_TOKEN")
    assert client.get("/learning/summary", params={"permutations": 100}).status_code == 200     # check is off when unset


def test_summary_filter_split_only_counts_revealed_episodes(client):
    a, b = new(client, seed=1), new(client, seed=2)
    for eid in (a, b):
        client.post(f"/episodes/{eid}/predictions", json={"horizon": 1, "p_up": 0.6})
        client.post(f"/episodes/{eid}/advance", json={"n": 1})
    only_a = client.post("/learning/summary", params={"permutations": 100}, json={"episode_ids": [a]}).json()
    both = client.get("/learning/summary", params={"permutations": 100}).json()
    assert only_a["overall"]["n"] == 1 and both["overall"]["n"] == 2
    assert only_a["by_kind"]["synthetic"]["n"] == 0                     # still open: the kind is hidden, so no split
    client.post(f"/episodes/{a}/reveal")
    revealed = client.post("/learning/summary", params={"permutations": 100}, json={"episode_ids": [a, b]}).json()
    assert revealed["by_kind"]["synthetic"]["n"] == 1                   # only the revealed one is split
    assert client.post("/learning/summary", json={"episode_ids": ["unknown"]}, params={"permutations": 100}).json()["overall"]["n"] == 0


def test_no_identity_before_reveal_through_the_api_real_episodes(client_real):
    rng = random.Random(1)
    for seed in range(20):
        r = client_real.post("/episodes", json={"kind": "real", "n_bars": 120, "seed": seed})
        eid = r.json()["episode_id"]
        bodies = [r.json()]
        client_real.post(f"/episodes/{eid}/predictions", json={"horizon": 1, "p_up": 0.55})
        for _ in range(rng.randint(1, 3)):
            bodies.append(client_real.post(f"/episodes/{eid}/advance", json={"n": rng.randint(1, 15)}).json())
        for path in ("", "/bars", "/predictions", "/score?permutations=100"):
            resp = client_real.get(f"/episodes/{eid}{path}")
            assert resp.status_code == 200
            bodies.append(resp.json())
            assert identity_findings(dict(resp.headers)) == []
        bodies.append(client_real.get("/learning/summary", params={"permutations": 100}).json())
        for body in bodies:
            assert identity_findings(body) == [], (seed, identity_findings(body))
        err = client_real.get("/episodes/zzzz/bars")
        assert identity_findings(err.json()) == []
    rev = client_real.post(f"/episodes/{eid}/reveal").json()
    assert rev["identity"]["symbol"] == "AAPL" and json.dumps(rev)


def test_existing_lineage_output_is_unchanged_by_the_source_parameter(db_real):
    from market_data.market.lineage import lineage

    default = lineage(db_real, "AAPL")
    assert default["source"] == "alpaca" and default["bars"] == 0
    tiingo = lineage(db_real, "AAPL", source="tiingo")
    assert tiingo["source"] == "tiingo" and tiingo["bars"] > 3000 and "internal use only" in tiingo["feed_caveat"]


def test_states_returns_many_public_states_in_one_call_and_skips_unknown(client, db):
    a, b = new(client, seed=1), new(client, seed=2)
    r = client.post("/episodes/states", json={"episode_ids": [a, b, "unknown"]})
    assert r.status_code == 200
    got = {e["episode_id"]: e for e in r.json()["episodes"]}
    assert set(got) == {a, b} and all("kind" in e for e in got.values())          # explicit synthetic request shows its kind
    assert client.post("/episodes/states", json={"episode_ids": []}).json() == {"episodes": []}
    assert identity_findings(r.json()) == []
