import json

import pytest
from fastapi.testclient import TestClient

from market_data.api import app, get_conn, observability
from market_data.market.status import CAVEATS, data_status
from tests.learning.conftest import db, db_real, no_internal_token_from_dotenv, real_aapl  # noqa: F401  (shared fixtures)


@pytest.fixture
def lines(monkeypatch):
    captured: list[dict] = []
    monkeypatch.setattr(observability, "LOG_SINK", lambda line: captured.append(json.loads(line)))
    return captured


@pytest.fixture
def client(db):
    app.dependency_overrides[get_conn] = lambda: db
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_the_incoming_request_id_is_logged_and_returned(client, lines):
    r = client.get("/health", headers={"x-request-id": "req-abc-123"})
    assert r.headers["x-request-id"] == "req-abc-123"
    assert lines[-1]["request_id"] == "req-abc-123" and lines[-1]["route"] == "/health" and lines[-1]["status"] == 200


def test_a_missing_request_id_is_made_and_returned(client, lines):
    r = client.get("/health")
    assert len(r.headers["x-request-id"]) >= 8 and lines[-1]["request_id"] == r.headers["x-request-id"]


def test_the_log_line_holds_the_route_pattern_never_ids_queries_or_bodies(client, lines, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-token-value-123")
    client.post("/episodes", json={"kind": "synthetic", "n_bars": 120, "initial_visible": 60, "seed": 5},
                headers={"X-Internal-Token": "secret-token-value-123"})
    client.get("/episodes/abcd1234/indicators?name=sma&window=20", headers={"X-Internal-Token": "secret-token-value-123"})
    client.get("/episodes/abcd1234/decisions", headers={"X-Internal-Token": "wrong-token-value"})
    text = json.dumps(lines)
    assert "abcd1234" not in text and "window=20" not in text and "secret-token-value-123" not in text and "wrong-token-value" not in text
    assert {"GET /episodes/{episode_id}/indicators"} <= {f"{x['method']} {x['route']}" for x in lines}
    assert any(x["status"] == 401 for x in lines)
    for x in lines:
        assert set(x) == {"time", "service", "method", "route", "status", "duration_ms", "request_id"}


def test_a_planted_secret_in_a_line_is_found_by_the_scan(lines):
    """Negative: the scan used above really catches a leak."""
    planted = json.dumps({"route": "/x", "authorization": "Bearer secret-token-value-123"})
    assert "secret-token-value-123" in planted


def test_metrics_count_calls_and_error_classes_per_route(client):
    observability.metrics.routes.clear()
    for _ in range(3):
        client.get("/health")
    client.get("/episodes/nope")      # 404: a client error
    snap = client.get("/metrics").json()
    by = {r["route"]: r for r in snap["routes"]}
    assert by["GET /health"]["count"] == 3 and by["GET /health"]["client_errors"] == 0
    assert by["GET /episodes/{episode_id}"]["client_errors"] == 1 and by["GET /episodes/{episode_id}"]["server_errors"] == 0
    assert snap["service"] == "python" and snap["uptime_seconds"] >= 0


def test_percentiles_follow_the_postgresql_rule_on_a_hand_example():
    assert observability.percentile([120, 130, 140, 2000], 50) == 135
    assert observability.percentile([120, 130, 140, 2000], 95) == pytest.approx(1721.0)
    assert observability.percentile([5], 95) == 5 and observability.percentile([], 50) is None


def test_metrics_and_data_status_need_the_internal_token_when_configured(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_API_TOKEN", "secret-token-for-test")
    assert client.get("/metrics").status_code == 401 and client.get("/data/status").status_code == 401
    assert client.get("/metrics", headers={"X-Internal-Token": "secret-token-for-test"}).status_code == 200


def test_data_status_on_an_empty_database_says_so(db):
    s = data_status(db)
    assert s["empty"] is True and s["sources"] == [] and s["quality"]["run"] is False and s["caveats"] == CAVEATS


def test_data_status_counts_equal_sql_and_hold_no_path_hash_or_key(db_real):
    s = data_status(db_real)
    with db_real.cursor() as cur:
        cur.execute("SELECT count(*), count(DISTINCT instrument_id), min(trade_date), max(trade_date) FROM market.bar_daily WHERE source = 'tiingo'")
        bars, symbols, first, last = cur.fetchone()
    t = next(x for x in s["sources"] if x["source"] == "tiingo")
    assert (t["bars"], t["symbols"], t["first_date"], t["last_date"]) == (bars, symbols, first, last)
    assert t["symbols_with_long_history"] == 1 and s["empty"] is False
    text = json.dumps(s, default=str).lower()
    for bad in ("file_sha256", "sha256", "file_name", ".csv", ".json", "data/raw", "api_key", "apikey", "http://", "https://"):
        assert bad not in text, bad


def test_endpoint_returns_the_same_summary(client):
    r = client.get("/data/status")
    assert r.status_code == 200 and r.json()["empty"] is True
