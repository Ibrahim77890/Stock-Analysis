"""Swagger "Backtest" endpoints (task 03_08). DB-writing tests use the throwaway TEST_DATABASE_URL database."""

import random
from datetime import date, timedelta

import psycopg
import pytest
from fastapi.testclient import TestClient

from market_data import config
from market_data.api import app, get_conn
from tests.test_replay_and_reads import _copy_upto

D = date
BODY = {"symbol": "AAPL", "start": "2020-07-27", "end": "2021-12-31", "fast": 5, "slow": 20,
        "commission_bps": 1, "slippage_bps": 2}


@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) "
                    "WHERE i.symbol = 'AAPL'")
        if cur.fetchone()[0] < 500:
            pytest.skip("real AAPL data not loaded")
    yield c
    c.close()


@pytest.fixture
def client(real, conn):
    """API wired to the throwaway database holding a copy of AAPL (so persist=true never touches real data)."""
    _copy_upto(real, conn, "AAPL", D(2021, 12, 31))
    with conn.cursor() as cur:
        cur.execute("TRUNCATE research.backtest_run RESTART IDENTITY CASCADE")
    conn.commit()
    app.dependency_overrides[get_conn] = lambda: conn
    yield TestClient(app)
    app.dependency_overrides.clear()


def count(conn, sql):
    with conn.cursor() as cur:
        cur.execute(sql)
        return cur.fetchone()[0]


def test_every_sprint_03_function_has_an_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {"/backtests/simulate": "post", "/backtests/metrics": "post", "/backtests/run": "post",
                "/backtests/fill-model-comparison": "post", "/backtests/cost-sweep": "post",
                "/backtests/shuffle-test": "post", "/backtests/causality-check": "post", "/backtests": "get",
                "/backtests/{run_id}": "get", "/backtests/{run_id}/trades": "get", "/backtests/{run_id}/equity": "get",
                "/backtests/{run_id}/reproduce": "post"}
    for p, m in expected.items():
        assert m in paths[p], p
    assert "Backtest" in {t["name"] for t in client.get("/openapi.json").json()["tags"]}


def test_simulate_golden_case_returns_hand_computed_equity(client):
    example = client.get("/openapi.json").json()["components"]["schemas"]["SimulateRequest"]["example"]
    out = client.post("/backtests/simulate", json=example).json()
    assert out["equity"][-1]["equity"] == pytest.approx(680.0) and out["realisable"] is True
    assert out["trades"][0]["entry_price"] == 12.5 and out["metrics"]["trades"] == 1


def test_simulate_rejects_unsorted_bars_with_400_and_bad_spec_with_422(client):
    example = client.get("/openapi.json").json()["components"]["schemas"]["SimulateRequest"]["example"]
    assert client.post("/backtests/simulate", json={**example, "bars": example["bars"][::-1]}).status_code == 400
    assert client.post("/backtests/simulate", json={**example, "fast": 3, "slow": 3}).status_code == 422


def test_metrics_endpoint(client):
    out = client.post("/backtests/metrics", json={"equity": [100, 110, 99, 120]}).json()
    assert out["total_return"] == pytest.approx(0.2) and out["max_drawdown"] == pytest.approx(-0.1)
    assert client.post("/backtests/metrics", json={"equity": []}).status_code == 422
    assert client.post("/backtests/metrics", json={"equity": [100, -5]}).status_code == 400


def test_run_twice_with_persist_gives_same_run_and_one_row_then_reproduce(client, conn):
    a = client.post("/backtests/run", json={**BODY, "persist": True}).json()
    b = client.post("/backtests/run", json={**BODY, "persist": True}).json()
    assert a["stored"]["run_id"] == b["stored"]["run_id"] and a["stored"]["created"] and not b["stored"]["created"]
    assert count(conn, "SELECT count(*) FROM research.backtest_run") == 1
    rid = a["stored"]["run_id"]
    assert client.post(f"/backtests/{rid}/reproduce").json()["status"] == "reproduced"
    assert client.get(f"/backtests/{rid}").json()["config_hash"] == a["config_hash"]
    assert len(client.get(f"/backtests/{rid}/trades").json()) == a["metrics"]["trades"]
    assert len(client.get(f"/backtests/{rid}/equity").json()) == a["bars_used"]
    assert client.get("/backtests").json()[0]["run_id"] == rid


def test_run_without_persist_writes_nothing(client, conn):
    assert client.post("/backtests/run", json=BODY).status_code == 200
    assert count(conn, "SELECT count(*) FROM research.backtest_run") == 0


def test_unknown_run_is_404(client):
    for path in ("/backtests/999", "/backtests/999/trades", "/backtests/999/equity"):
        assert client.get(path).status_code == 404
    assert client.post("/backtests/999/reproduce").status_code == 404


def test_validation_and_unknown_symbol(client):
    assert client.post("/backtests/run", json={**BODY, "fast": 20, "slow": 20}).status_code == 422
    assert client.post("/backtests/run", json={**BODY, "symbol": "NOPE"}).status_code == 404
    assert client.post("/backtests/shuffle-test", json={**BODY, "n_paths": 5000}).status_code == 422
    assert client.post("/backtests/cost-sweep", json={**BODY, "grid_bps": list(range(21))}).status_code == 422
    assert client.post("/backtests/cost-sweep", json={**BODY, "grid_bps": [5, 1]}).status_code == 400


def test_sql_injection_symbol_changes_nothing(client, conn):
    before = (count(conn, "SELECT count(*) FROM market.bar_daily"), count(conn, "SELECT count(*) FROM research.backtest_run"))
    short = client.post("/backtests/run", json={**BODY, "symbol": "A'; DROP--", "persist": True})
    long = client.post("/backtests/run", json={**BODY, "symbol": "AAPL'; DROP TABLE market.bar_daily;--", "persist": True})
    assert short.status_code == 404 and long.status_code == 422  # unknown symbol / longer than 20 characters
    assert before == (count(conn, "SELECT count(*) FROM market.bar_daily"), count(conn, "SELECT count(*) FROM research.backtest_run"))


def test_fill_model_cost_sweep_shuffle_and_causality_endpoints(client):
    cmp = client.post("/backtests/fill-model-comparison", json=BODY).json()
    assert cmp["same_close"]["realisable"] is False and "look-ahead" in cmp["warning"]
    sweep = client.post("/backtests/cost-sweep", json={**BODY, "grid_bps": [0, 5, 50]}).json()
    assert [r["cost_bps"] for r in sweep["rows"]] == [0, 5, 50] and "break_even_zero_bps" in sweep
    sh = client.post("/backtests/shuffle-test", json={**BODY, "n_paths": 20, "seed": 3}).json()
    assert sh["n_paths"] == 20 and "paths" not in sh and 0 <= sh["total_return"]["percentile_rank"] <= 1
    assert client.post("/backtests/shuffle-test", json={**BODY, "n_paths": 5, "include_paths": True}).json()["paths"]
    ca = client.post("/backtests/causality-check", json={**BODY, "cut_points": 10}).json()
    assert ca["passed"] is True and ca["mismatches"] == []


def test_replay_boundary_end_date_fuzz(client):
    rng = random.Random(2)
    for _ in range(50):
        end = D(2020, 9, 15) + timedelta(days=rng.randrange(0, 450))
        out = client.post("/backtests/run", json={**BODY, "end": end.isoformat(), "include_equity": True}).json()
        assert max(r["trade_date"] for r in out["equity"]) <= end.isoformat()
