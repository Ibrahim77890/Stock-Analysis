import json
import re

import pytest
from fastapi.testclient import TestClient

from market_data.api import app, get_conn
from tests.lab.conftest import SYMBOL

ISO = re.compile(r"\d{4}-\d{2}-\d{2}")
RUN = {"fast": 10, "slow": 40, "cost_bps": 2.0, "seed": 1, "n_paths": 10}


@pytest.fixture
def client(lab_db):
    app.dependency_overrides[get_conn] = lambda: lab_db
    yield TestClient(app)
    app.dependency_overrides.clear()


def new_study(client):
    r = client.post("/lab/studies", json={"symbol": SYMBOL})
    assert r.status_code == 200, r.text
    return r.json()["study_id"]


def test_every_sprint_07_function_has_an_endpoint(client):
    schema = client.get("/openapi.json").json()
    paths = schema["paths"]
    expected = {"eligible_symbols": ("/lab/stocks", "get"), "create_lab_study": ("/lab/studies", "post"),
                "list_studies_info": ("/lab/studies/info", "post"), "study_overview": ("/lab/studies/{study_id}", "get"),
                "run_practice": ("/lab/studies/{study_id}/runs", "post"), "open_vault": ("/lab/studies/{study_id}/vault", "post"),
                "vault_result": ("/lab/studies/{study_id}/vault", "get")}
    for fn, (path, method) in expected.items():
        assert method in paths[path], fn
    assert "Lab" in {t["name"] for t in schema["tags"]}


def test_token_rule(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "t" * 32)
    assert client.get("/lab/stocks").status_code == 401
    assert client.get("/lab/stocks", headers={"X-Internal-Token": "wrong"}).status_code == 401
    ok = client.get("/lab/stocks", headers={"X-Internal-Token": "t" * 32})
    assert ok.status_code == 200 and "t" * 32 not in ok.text
    monkeypatch.delenv("INTERNAL_API_TOKEN")
    assert client.get("/lab/stocks").status_code == 200


def test_end_to_end_create_run_repeat_overview_vault_twice(client):
    assert [s["symbol"] for s in client.get("/lab/stocks").json()["stocks"]] == [SYMBOL]
    sid = new_study(client)
    a = client.post(f"/lab/studies/{sid}/runs", json=RUN).json()
    b = client.post(f"/lab/studies/{sid}/runs", json={**RUN, "fast": 5, "slow": 25}).json()
    c = client.post(f"/lab/studies/{sid}/runs", json=RUN).json()
    assert (a["counted"], b["counted"], c["counted"]) == (True, True, False) and c["rule"] == a["rule"]
    ov = client.get(f"/lab/studies/{sid}").json()
    assert ov["ideas_tried"] == 2 and ov["vault_open"] is False
    assert client.get(f"/lab/studies/{sid}/vault").status_code == 422
    v = client.post(f"/lab/studies/{sid}/vault", json={"fast": 10, "slow": 40, "cost_bps": 2.0})
    assert v.status_code == 200 and v.json()["ideas_tried"] == 2
    again = client.post(f"/lab/studies/{sid}/vault", json={"fast": 10, "slow": 40, "cost_bps": 2.0})
    assert again.status_code == 409 and "already opened" in again.json()["detail"]
    assert client.get(f"/lab/studies/{sid}").json()["vault_open"] is True
    assert client.get(f"/lab/studies/{sid}/vault").json()["rule"] == v.json()["rule"]
    info = client.post("/lab/studies/info", json={"study_ids": [sid, 9999]}).json()["studies"]
    assert [s["study_id"] for s in info] == [sid] and info[0]["vault_open"] is True


@pytest.mark.parametrize("body,needle", [
    ({"fast": 40, "slow": 40}, "shorter"), ({"fast": 20, "slow": 10}, "shorter"),
    ({"fast": 5, "slow": 301}, None), ({"fast": 5, "slow": 20, "cost_bps": 51}, None),
    ({"fast": 1, "slow": 20}, None), ({"fast": 5, "slow": 20, "n_paths": 201}, None),
    ({"fast": 5, "slow": 20, "n_paths": 9}, None)])
def test_each_cap_returns_422_and_changes_nothing(client, body, needle):
    sid = new_study(client)
    r = client.post(f"/lab/studies/{sid}/runs", json={"cost_bps": 2.0, "seed": 1, "n_paths": 10, **body})
    assert r.status_code == 422
    if needle:
        assert needle in json.dumps(r.json())
    assert client.get(f"/lab/studies/{sid}").json()["ideas_tried"] == 0


def test_unknown_things_and_run_order(client):
    assert client.post("/lab/studies", json={"symbol": "NOPE"}).status_code == 404
    assert client.get("/lab/studies/9999").status_code == 404
    assert client.post("/lab/studies/9999/runs", json=RUN).status_code == 404
    sid = new_study(client)
    r = client.post(f"/lab/studies/{sid}/vault", json={"fast": 10, "slow": 40, "cost_bps": 2.0})
    assert r.status_code == 422 and "practice" in r.json()["detail"]
    assert client.post("/lab/studies", json={"symbol": "bad symbol!"}).status_code == 422


def test_no_vault_date_leaves_the_api_before_the_vault_is_opened(client, lab_db):
    from tests.lab.conftest import session_days, N_BARS
    sid = new_study(client)
    with lab_db.cursor() as cur:
        cur.execute("SELECT practice_end FROM research.lab_study WHERE study_id=%s", (sid,))
        pe = cur.fetchone()[0].isoformat()
    vault_days = [d.isoformat() for d in session_days(N_BARS) if d.isoformat() > pe]
    texts = [client.post("/lab/studies", json={"symbol": SYMBOL}),
             client.post(f"/lab/studies/{sid}/runs", json=RUN), client.get(f"/lab/studies/{sid}"),
             client.get("/lab/stocks"), client.post("/lab/studies/info", json={"study_ids": [sid]}),
             client.get(f"/lab/studies/{sid}/vault"), client.post(f"/lab/studies/{sid}/runs", json={**RUN, "fast": 50, "slow": 10}),
             client.post(f"/lab/studies/{sid}/vault", json={"fast": 11, "slow": 41, "cost_bps": 2.0}),
             client.get("/lab/studies/9999")]
    for r in texts:
        body = r.text + json.dumps(dict(r.headers))
        stamps = [d for d in ISO.findall(body) if d > pe]
        assert not stamps, (r.request.url, stamps[:3])
        assert not any(d in body for d in vault_days[:50])
    # the last practice date is part of the chart (allowed); the first vault day never is
    assert vault_days[0] not in texts[1].text


def test_run_response_is_bounded_and_repeatable(client):
    sid = new_study(client)
    a = client.post(f"/lab/studies/{sid}/runs", json=RUN)
    b = client.post(f"/lab/studies/{sid}/runs", json=RUN)
    ja, jb = a.json(), b.json()
    assert len(ja["growth"]["dates"]) <= 300 and len(a.content) < 150_000
    for k in ("rule", "buy_hold", "growth", "yearly", "costs", "luck", "config_hash"):
        assert json.dumps(ja[k], sort_keys=True) == json.dumps(jb[k], sort_keys=True)
