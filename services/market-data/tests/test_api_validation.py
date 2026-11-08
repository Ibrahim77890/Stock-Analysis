"""Swagger "Validation" endpoints (task 04_08). Writing tests use the throwaway TEST_DATABASE_URL database."""

import random
from datetime import date, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from market_data import config
from market_data.api import app, get_conn
from tests.test_replay_and_reads import _copy_upto

D = date
WIN = {"symbol": "AAPL", "start": "2020-07-27", "end": "2023-12-31"}
GRID = {"fast_values": [3, 5, 8], "slow_values": [20, 30, 40]}


@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE i.symbol='AAPL'")
        if cur.fetchone()[0] < 500:
            pytest.skip("real AAPL data not loaded")
    yield c
    c.close()


@pytest.fixture
def client(real, conn):
    _copy_upto(real, conn, "AAPL", D(2023, 12, 31))
    with conn.cursor() as cur:
        cur.execute("TRUNCATE research.study RESTART IDENTITY CASCADE")
    conn.commit()
    app.dependency_overrides[get_conn] = lambda: conn
    yield TestClient(app)
    app.dependency_overrides.clear()


def count(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchone()[0]


def test_every_sprint_04_function_has_an_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {"/validation/grid-search": "post", "/validation/split-evaluation": "post", "/validation/holdout": "post",
                "/validation/walk-forward": "post", "/validation/sharpe-stats": "post", "/validation/studies": "get",
                "/validation/studies/{study_id}": "get", "/validation/universe-scan": "post",
                "/validation/best-of-n": "post", "/validation/regimes": "post"}
    for p, m in expected.items():
        assert m in paths[p], p
    assert "Validation" in {t["name"] for t in client.get("/openapi.json").json()["tags"]}


def test_sharpe_stats_golden_and_deflation(client):
    import numpy as np
    r = list(np.random.default_rng(1).normal(0.001, 0.01, 1000))
    out = client.post("/validation/sharpe-stats", json={"returns": r}).json()
    assert 0.5 < out["psr"] < 1 and out["moments"]["T"] == 1000
    out2 = client.post("/validation/sharpe-stats", json={"returns": r, "trial_sharpes": [0.01, 0.05, 0.02, 0.07]}).json()
    assert out2["deflated"]["n_trials"] == 4 and out2["deflated"]["dsr"] is not None
    short = client.post("/validation/sharpe-stats", json={"returns": r[:10]}).json()
    assert short["psr"] is None and "fewer" in short["reason"]
    assert client.post("/validation/sharpe-stats", json={"returns": [0.1]}).status_code == 422


def test_grid_search_record_false_writes_nothing_and_true_counts_attempts(client, conn):
    a = client.post("/validation/grid-search", json={**WIN, **GRID}).json()
    assert a["trials"] == 9 and "study_id" not in a and count(conn, "SELECT count(*) FROM research.study") == 0
    b = client.post("/validation/grid-search", json={**WIN, **GRID, "record": True}).json()
    c = client.post("/validation/grid-search", json={**WIN, **GRID, "record": True}).json()
    assert b["study_id"] != c["study_id"] and count(conn, "SELECT count(*) FROM research.study") == 2
    assert count(conn, "SELECT count(*) FROM research.trial") == 18
    s = client.get(f"/validation/studies/{b['study_id']}").json()
    assert s["trial_count"] == 9 and s["overfitting_meter"]["trials"] == 9
    assert {x["study_id"] for x in client.get("/validation/studies").json()} == {b["study_id"], c["study_id"]}


def test_split_walk_forward_and_holdout_flow(client, conn):
    sp = client.post("/validation/split-evaluation", json={**WIN, **GRID, "train_bars": 500, "record": True}).json()
    assert sp["trials"] == 9 and sp["out_of_sample"]["bars"] > 60 and "study_id" in sp
    wf = client.post("/validation/walk-forward", json={**WIN, **GRID, "train": 400, "test": 100}).json()
    assert wf["fold_count"] >= 4 and abs(wf["stitched_growth"] - wf["product_of_fold_growth"]) < 1e-9
    sid = sp["study_id"]
    body = {**WIN, "study_id": sid, "fast": 5, "slow": 20, "holdout_bars": 150}
    first = client.post("/validation/holdout", json=body)
    assert first.status_code == 200
    n = count(conn, "SELECT count(*) FROM research.trial")
    second = client.post("/validation/holdout", json=body)
    assert second.status_code == 409 and count(conn, "SELECT count(*) FROM research.trial") == n
    assert client.post("/validation/holdout", json={**body, "study_id": 999}).status_code == 404


def test_scan_best_of_n_and_regimes(client):
    scan = client.post("/validation/universe-scan", json={**WIN, "symbols": ["AAPL"], "min_bars": 100}).json()
    assert scan["n"] == 1 and scan["caveat"]
    b = client.post("/validation/best-of-n", json={**WIN, "symbols": ["AAPL"], "min_bars": 100, "replicates": 5}).json()
    assert b["n_symbols"] == 1 and b["replicates"] == 5
    for by in ("year", "vol"):
        rg = client.post("/validation/regimes", json={**WIN, "by": by}).json()
        assert abs(rg["total_growth"] - rg["product_of_group_growth"]) < 1e-9
    assert client.post("/validation/regimes", json={**WIN, "by": "month"}).status_code == 422


def test_validation_and_error_codes(client, conn):
    many = {"fast_values": list(range(1, 22)), "slow_values": list(range(30, 52))}  # 21 x 22 = 462 pairs > 400
    assert client.post("/validation/grid-search", json={**WIN, **many}).status_code == 422
    assert client.post("/validation/grid-search", json={**WIN, "fast_values": [30], "slow_values": [20]}).status_code == 422
    assert client.post("/validation/grid-search", json={**WIN, "fast_values": [5, 5], "slow_values": [20]}).status_code == 422
    assert client.post("/validation/grid-search", json={**WIN, **GRID, "symbol": "NOPE"}).status_code == 404
    assert client.post("/validation/best-of-n", json={**WIN, "replicates": 5000}).status_code == 422
    assert client.post("/validation/universe-scan", json={**WIN, "symbols": ["AAPL", "NOPE"]}).status_code == 400
    assert client.get("/validation/studies/424242").status_code == 404
    assert client.post("/validation/split-evaluation", json={**WIN, **GRID, "train_bars": 50}).status_code == 400


def test_injection_style_symbol_changes_nothing(client, conn):
    before = (count(conn, "SELECT count(*) FROM market.bar_daily"), count(conn, "SELECT count(*) FROM research.study"))
    r = client.post("/validation/grid-search", json={**WIN, **GRID, "symbol": "A'; DROP--", "record": True})
    assert r.status_code == 404
    assert before == (count(conn, "SELECT count(*) FROM market.bar_daily"), count(conn, "SELECT count(*) FROM research.study"))


def test_replay_boundary_end_date_fuzz(client):
    rng = random.Random(3)
    for _ in range(50):
        end = D(2021, 6, 1) + timedelta(days=rng.randrange(0, 900))
        out = client.post("/validation/grid-search", json={**WIN, "end": end.isoformat(), "fast_values": [5], "slow_values": [20]})
        assert out.status_code == 200 and out.json()["window"][1] <= end.isoformat()
