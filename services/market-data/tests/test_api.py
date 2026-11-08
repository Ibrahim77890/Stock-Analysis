"""HTTP API, lineage, contract and real-data read tests (tasks 02_01, 02_06, 02_07)."""

import json
import random
import shutil
from datetime import date, timedelta
from pathlib import Path

import polars as pl
import psycopg
import pytest
from fastapi.testclient import TestClient

from market_data import config
from market_data.api import app, openapi_schema
from market_data.cli import main as cli_main
from market_data.lineage import lineage
from market_data.read import get_bars

CONTRACT = Path(__file__).resolve().parents[3] / "docs" / "02-domain" / "openapi-market-data.json"


@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE i.symbol='AAPL'")
        if cur.fetchone()[0] < 100:
            pytest.skip("real AAPL data not loaded")
    yield c
    c.close()


@pytest.fixture(scope="module")
def client(real):
    return TestClient(app)


def bar_count(real):
    with real.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily")
        return cur.fetchone()[0]


# ---- 02_01: real-data read test

def test_get_bars_equals_raw_parquet_for_aapl(real):
    path = config.DATA_DIR / "raw" / "alpaca" / "bars_1d" / "AAPL.parquet"
    if not path.exists():
        pytest.skip("raw AAPL file not present")
    from market_data.load import normalise_bars

    exp = normalise_bars(pl.read_parquet(path), "AAPL").filter(
        (pl.col("trade_date") >= date(2020, 8, 25)) & (pl.col("trade_date") <= date(2020, 9, 4))
    ).sort("trade_date").select("trade_date", "open", "high", "low", "close", "volume")
    got = get_bars(real, "AAPL", date(2020, 8, 25), date(2020, 9, 4))
    assert got.height == 9 and got.equals(exp)
    # negative: one changed price must not compare equal
    assert not got.equals(exp.with_columns(pl.when(pl.int_range(pl.len()) == 0).then(pl.col("close") + 1).otherwise(pl.col("close")).alias("close")))


# ---- 02_06: API

def test_health_and_swagger_ui(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/docs").status_code == 200


def test_every_function_group_is_in_swagger(client):
    tags = {t["name"] for t in client.get("/openapi.json").json()["tags"]}
    assert tags == {"Reference", "Bars", "Adjustment", "Indicators", "Replay", "Lineage", "Data quality", "Ingestion", "Benchmark"}
    paths = client.get("/openapi.json").json()["paths"]
    for p in ["/bars", "/adjust/preview", "/indicators/compute", "/indicators/causality-check", "/replay/sessions",
              "/lineage/{symbol}", "/quality/rules/check", "/quality/run", "/ingestion/load", "/ingestion/download",
              "/ingestion/verify", "/benchmark/results", "/instruments", "/corporate-actions"]:
        assert p in paths


def test_bars_happy_path_adjusted_with_indicators(client):
    r = client.get("/bars", params={"symbol": "AAPL", "start": "2020-08-25", "end": "2020-09-04",
                                    "adjustment": "split", "indicators": "sma:3,simple_return"})
    d = r.json()
    assert r.status_code == 200 and d["count"] == 9 and d["cursor"] == "2020-09-04"
    assert [b["factor"] for b in d["bars"]][:4] == [0.25] * 4 and d["bars"][4]["factor"] == 1.0
    assert d["bars"][0]["indicators"]["sma:3"] is not None  # warm-up comes from bars before `start`
    assert d["bars"][4]["indicators"]["simple_return"] == pytest.approx(0.0342, abs=1e-3)


def test_error_codes(client):
    base = {"start": "2020-01-01", "end": "2020-02-01"}
    assert client.get("/bars", params={"symbol": "ZZZZ", **base}).status_code == 404
    assert client.get("/bars", params={"symbol": "AAPL", "start": "2020-02-01", "end": "2020-01-01"}).status_code == 400
    assert client.get("/bars", params={"symbol": "AAPL", **base, "adjustment": "x"}).status_code == 422
    assert client.get("/bars", params={"symbol": "AAPL", "start": "banana", "end": "2020-01-01"}).status_code == 422
    assert client.get("/bars", params={"symbol": "AAPL", **base, "indicators": "nope:3"}).status_code == 400


def test_cursor_before_start_is_empty(client):
    r = client.get("/bars", params={"symbol": "AAPL", "start": "2020-08-25", "end": "2020-09-04", "cursor": "2020-01-01"})
    assert r.status_code == 200 and r.json()["count"] == 0


def test_cursor_fuzz_over_http_never_leaks_future(client):
    rng = random.Random(3)
    for _ in range(200):
        cursor = date(2018, 6, 1) + timedelta(days=rng.randrange(0, 2800))
        adj = rng.choice(["raw", "split", "split_dividend"])
        d = client.get("/bars", params={"symbol": rng.choice(["AAPL", "NVDA", "SPY"]), "start": "2016-01-01",
                                        "end": "2025-12-31", "cursor": cursor.isoformat(), "adjustment": adj}).json()
        assert all(b["trade_date"] <= cursor.isoformat() for b in d["bars"]), (cursor, adj)


def test_sql_injection_in_symbol_changes_nothing(client, real):
    before = bar_count(real)
    r = client.get("/bars", params={"symbol": "AAPL'; DROP TABLE market.bar_daily;--", "start": "2020-01-01", "end": "2020-02-01"})
    assert r.status_code == 404 and bar_count(real) == before


def test_adjust_preview_golden_example(client):
    body = {"bars": [{"trade_date": "2020-01-01", "open": 400, "high": 400, "low": 400, "close": 400, "volume": 1000},
                     {"trade_date": "2020-01-02", "open": 100, "high": 100, "low": 100, "close": 100, "volume": 4000}],
            "actions": [{"action_type": "split", "ex_date": "2020-01-02", "split_from": 1, "split_to": 4}],
            "as_of": "2020-01-02", "mode": "split"}
    d = client.post("/adjust/preview", json=body).json()
    assert [b["close"] for b in d["bars"]] == [100.0, 100.0] and d["bars"][0]["factor"] == 0.25
    body["as_of"] = "2020-01-01"
    assert [b["close"] for b in client.post("/adjust/preview", json=body).json()["bars"]] == [400.0]


def test_indicator_endpoints(client):
    d = client.post("/indicators/compute", json={"closes": [10, 11, 12, 13], "specs": ["sma:3", "simple_return"]}).json()
    assert d["indicators"]["sma:3"] == [None, None, 11.0, 12.0]
    closes = [float(100 + (i * 7) % 13 + i) for i in range(80)]
    ok = client.post("/indicators/causality-check", json={"indicator": "sma:5", "closes": closes}).json()
    bad = client.post("/indicators/causality-check", json={"indicator": "leaky_centered_sma:5", "closes": closes}).json()
    assert ok["causal"] is True and bad["causal"] is False
    sym = client.get("/indicators/AAPL", params={"start": "2020-08-25", "end": "2020-09-04", "specs": "ema:3"})
    assert sym.status_code == 200 and sym.json()["count"] == 9


def test_quality_rule_check_endpoint(client):
    body = {"rule": "large_move", "threshold": 0.4, "splits": [{"symbol": "A", "ex_date": "2020-08-31"}],
            "bars": [{"symbol": "A", "trade_date": "2020-08-28", "open": 400, "high": 405, "low": 395, "close": 400, "volume": 1},
                     {"symbol": "A", "trade_date": "2020-08-31", "open": 100, "high": 102, "low": 98, "close": 100, "volume": 1}]}
    d = client.post("/quality/rules/check", json=body).json()
    assert d["flagged"][0]["detail"]["explained_by_split"] is True
    body["splits"] = []
    assert client.post("/quality/rules/check", json=body).json()["flagged"][0]["detail"]["explained_by_split"] is False
    assert client.post("/quality/rules/check", json={**body, "rule": "nope"}).status_code == 400


def test_replay_session_flow_blind_and_no_future(client):
    s = client.post("/replay/sessions", json={"symbol": "AAPL", "start": "2020-08-25"}).json()
    sid = s["session_id"]
    assert s["cursor"] == "2020-08-25"
    adv = client.post(f"/replay/sessions/{sid}/advance", json={"n_sessions": 4}).json()
    bars_ = client.get(f"/replay/sessions/{sid}/bars").json()
    assert bars_["count"] == 5 and bars_["bars"][-1]["trade_date"] == adv["cursor"]
    blind = client.get(f"/replay/sessions/{sid}/bars", params={"blind": True}).json()
    assert blind["symbol"] is None and blind["bars"][0]["trade_date"] is None
    assert blind["bars"][0]["close"] == pytest.approx(100.0) and blind["bars"][0]["day"] == 1
    assert client.post(f"/replay/sessions/{sid}/advance", json={"n_sessions": -1}).status_code == 400
    assert client.get("/replay/sessions/nope").status_code == 404


def test_reference_ingestion_and_benchmark_endpoints(client):
    assert any(i["symbol"] == "AAPL" for i in client.get("/instruments").json())
    assert len(client.get("/universe").json()) >= 45
    assert any(a["action_type"] == "split" for a in client.get("/corporate-actions", params={"symbol": "AAPL"}).json())
    assert client.get("/ingestion/jobs", params={"limit": 5}).status_code == 200
    assert client.get("/ingestion/quarantine").status_code == 200
    assert client.get("/ingestion/raw-files").status_code == 200
    assert client.post("/ingestion/verify").json()["failed"] == []
    assert client.get("/quality/runs").status_code == 200 and client.get("/quality/results").status_code == 200
    assert isinstance(client.get("/benchmark/results").json(), dict)


def test_openapi_contract_matches_committed_file():
    assert CONTRACT.exists(), "run: uv run market-data export-openapi"
    assert json.loads(CONTRACT.read_text(encoding="utf-8")) == json.loads(json.dumps(openapi_schema(), sort_keys=True))


def test_contract_test_detects_a_renamed_field():
    changed = json.loads(CONTRACT.read_text(encoding="utf-8"))
    changed["components"]["schemas"]["BarRow"]["properties"]["closing"] = changed["components"]["schemas"]["BarRow"]["properties"].pop("close")
    assert changed != json.loads(json.dumps(openapi_schema(), sort_keys=True))


def test_serve_refuses_non_loopback_host():
    assert cli_main(["serve", "--host", "0.0.0.0"]) == 2


# ---- 02_07: lineage

def test_lineage_matches_manifest_and_job(real):
    d = lineage(real, "AAPL")
    m = json.loads((config.DATA_DIR / "raw" / "alpaca" / "bars_1d" / "AAPL.parquet.manifest.json").read_text())
    assert d["manifest"]["manifest_sha256"] == m["file_sha256"] and d["manifest"]["hash_matches"] is True
    assert d["jobs"] and all(j["reconciles"] for j in d["jobs"])
    assert "IEX" in d["feed_caveat"] and "survivor" in d["universe_caveat"]
    assert d["manifest"]["feed"] == "iex" and d["stored_adjustment"] == "raw"


def test_lineage_cursor_excludes_later_quality_flags(real):
    full = lineage(real, "AAPL")["quality_counts"]
    early = lineage(real, "AAPL", cursor=date(2020, 8, 1))["quality_counts"]
    assert full.get("large_move", 0) == 1 and early.get("large_move", 0) == 0  # the split flag is on 2020-08-31


def test_lineage_endpoint_404_and_tampered_manifest(real, client, tmp_path):
    assert client.get("/lineage/NOPE").status_code == 404
    src = config.DATA_DIR / "raw" / "alpaca" / "bars_1d"
    dst = tmp_path / "raw" / "alpaca" / "bars_1d"
    dst.mkdir(parents=True)
    shutil.copy(src / "AAPL.parquet", dst / "AAPL.parquet")
    mf = json.loads((src / "AAPL.parquet.manifest.json").read_text())
    mf["file_sha256"] = "0" * 64
    (dst / "AAPL.parquet.manifest.json").write_text(json.dumps(mf))
    d = lineage(real, "AAPL", data_dir=tmp_path)
    assert d["manifest"]["hash_matches"] is False and any("hash mismatch" in w for w in d["warnings"])


def test_lineage_missing_manifest_is_a_warning_not_an_error(real, tmp_path):
    d = lineage(real, "AAPL", data_dir=tmp_path)
    assert d["manifest"] is None and any("manifest" in w for w in d["warnings"])
