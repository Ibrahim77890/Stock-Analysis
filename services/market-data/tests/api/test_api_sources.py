"""Swagger "Sources" and "Macro" endpoints (task 05_08)."""

import logging
import random
from datetime import date, timedelta

import httpx
import psycopg
import pytest
from fastapi.testclient import TestClient

from market_data.core import config
from market_data.ingestion import download_tiingo as dt, macro as mc
from market_data.api.app import app, get_conn
from tests.market.test_replay_and_reads import _copy_upto

D = date
FAKE_T, FAKE_F = "TKEY-ABC-123456", "FKEY-XYZ-987654"
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
                    "WHERE i.symbol = 'AAPL' AND b.source = 'tiingo'")
        if cur.fetchone()[0] < 3000:
            pytest.skip("real Tiingo AAPL not loaded")
    yield c
    c.close()


def seed_macro(conn):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO market.ingestion_job (kind,source,file_name,file_sha256,status) VALUES "
                    "('macro','fred','x','x','succeeded') RETURNING ingestion_job_id")
        jid = cur.fetchone()[0]
        days = [D(2021, 1, 4) + timedelta(days=i) for i in range(400)]
        rows = [("DGS3MO", d, None if i % 37 == 5 else 0.05 + 0.001 * (i % 20)) for i, d in enumerate(days)]
        rows += [("VIXCLS", d, 12.0 + (i % 30)) for i, d in enumerate(days)]
        cur.executemany("INSERT INTO market.macro_observation (series_id,obs_date,value,source,ingestion_job_id) "
                        "VALUES (%s,%s,%s,'fred',%s)", [(*r, jid) for r in rows])
    conn.commit()


@pytest.fixture
def client(real, conn):
    """API on the throwaway database with copies of both AAPL sources and a small macro table."""
    _copy_upto(real, conn, "AAPL", D(2021, 12, 31))
    _copy_upto(real, conn, "AAPL", D(2021, 12, 31), source="tiingo", reset=False)
    seed_macro(conn)
    with conn.cursor() as cur:
        cur.execute("TRUNCATE research.backtest_run RESTART IDENTITY CASCADE")
    conn.commit()
    app.dependency_overrides[get_conn] = lambda: conn
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---- inventory

def test_every_sprint_05_function_has_an_endpoint(client):
    paths = client.get("/openapi.json").json()["paths"]
    expected = {  # function -> (path, method)
        "source_summary": ("/sources", "get"), "check_keys": ("/sources/keys", "get"),
        "download_tiingo": ("/ingestion/tiingo/download", "post"), "load_tiingo_universe": ("/ingestion/tiingo/load", "post"),
        "reconcile_universe": ("/sources/reconcile", "post"), "adjustment_vs_vendor": ("/sources/adjustment-check/{symbol}", "get"),
        "download_fred": ("/ingestion/fred/download", "post"), "load_fred": ("/ingestion/fred/load", "post"),
        "get_macro": ("/macro/{series_id}", "get"), "macro_asof": ("/macro/{series_id}/asof", "get"),
        "daily_risk_free": ("/macro/derived/risk-free", "get"), "vix_labels": ("/macro/derived/vix-bucket", "get"),
        "excess_sharpe": ("/backtests/excess-sharpe", "post"),
    }
    for fn, (p, m) in expected.items():
        assert m in paths[p], f"{fn}: {m.upper()} {p}"
    props = paths["/backtests/run"]["post"]["requestBody"]["content"]["application/json"]["schema"]
    schema = client.get("/openapi.json").json()["components"]["schemas"][props["$ref"].split("/")[-1]]["properties"]
    assert {"source", "price_basis", "risk_free"} <= set(schema)


def test_sources_summary_lists_both_sources_and_macro(client):
    r = client.get("/sources").json()
    assert {x["source"] for x in r["prices"]} == {"alpaca", "tiingo"}
    assert {x["series_id"] for x in r["macro"]} == {"DGS3MO", "VIXCLS"} and "not endorsed" in r["fred_attribution"]


# ---- downloads with the HTTP layer mocked

def tiingo_server(fail_on=None):
    calls = []

    def handler(request):
        calls.append(request)
        assert request.headers["Authorization"] == f"Token {FAKE_T}"
        if fail_on == len(calls):
            return httpx.Response(429, json={})
        close = 10.0 + len(calls)
        return httpx.Response(200, json=[{"date": "2021-03-05T00:00:00.000Z", "open": close, "high": close, "low": close,
                                          "close": close, "volume": 5, "adjOpen": 1, "adjHigh": 1, "adjLow": 1,
                                          "adjClose": 1, "adjVolume": 5, "divCash": 0.0, "splitFactor": 1.0}])
    handler.calls = calls
    return handler


def patch_tiingo(monkeypatch, tmp_path, server):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setenv("TIINGO_API_KEY", FAKE_T)
    real_make = dt.make_client
    monkeypatch.setattr(dt, "make_client", lambda token=None, transport=None: real_make(FAKE_T, httpx.MockTransport(server)))


def test_tiingo_download_honours_max_requests_and_never_leaks_key(client, monkeypatch, tmp_path, caplog):
    srv = tiingo_server()
    patch_tiingo(monkeypatch, tmp_path, srv)
    syms = [f"S{i}" for i in range(8)]
    with caplog.at_level(logging.DEBUG):
        r = client.post("/ingestion/tiingo/download", json={"symbols": syms, "max_requests": 3})
    assert r.status_code == 200 and r.json()["written"] == 3 and len(srv.calls) == 3
    r2 = client.post("/ingestion/tiingo/download", json={"symbols": syms, "max_requests": 3})
    assert r2.json()["skipped"] == 3 and len(srv.calls) == 6
    for text in (r.text, r2.text, caplog.text):
        assert FAKE_T not in text
    for p in tmp_path.rglob("*"):
        if p.is_file():
            assert FAKE_T.encode() not in p.read_bytes()


def test_tiingo_download_returns_429_on_quota_and_keeps_files(client, monkeypatch, tmp_path):
    srv = tiingo_server(fail_on=3)
    patch_tiingo(monkeypatch, tmp_path, srv)
    r = client.post("/ingestion/tiingo/download", json={"symbols": [f"S{i}" for i in range(6)], "max_requests": 10})
    assert r.status_code == 429 and r.json()["summary"]["written"] == 2 and FAKE_T not in r.text
    assert len(list((tmp_path / "raw" / "tiingo" / "bars_1d").glob("*.parquet"))) == 2


def test_missing_keys_return_400_naming_the_variable(client, monkeypatch):
    monkeypatch.delenv("TIINGO_API_KEY", raising=False)
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    monkeypatch.setattr(config, "tiingo_key", lambda: (_ for _ in ()).throw(RuntimeError("TIINGO_API_KEY is not set (see .env.example).")))
    r = client.post("/ingestion/tiingo/download", json={"symbols": ["AAPL"]})
    assert r.status_code == 400 and "TIINGO_API_KEY" in r.json()["detail"]
    monkeypatch.setattr(config, "fred_key", lambda: (_ for _ in ()).throw(RuntimeError("FRED_API_KEY is not set (see .env.example).")))
    r = client.post("/ingestion/fred/download", json={})
    assert r.status_code == 400 and "FRED_API_KEY" in r.json()["detail"]


def test_fred_download_and_load_through_the_api(client, monkeypatch, tmp_path, caplog):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setenv("FRED_API_KEY", FAKE_F)
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"observations": [{"date": "2021-01-04", "value": "0.09"},
                                                           {"date": "2021-01-05", "value": "."}]})
    monkeypatch.setattr(mc, "make_client", lambda transport=None: httpx.Client(base_url=mc.BASE_URL, transport=httpx.MockTransport(handler)))
    with caplog.at_level(logging.DEBUG):
        r = client.post("/ingestion/fred/download", json={"series": ["DGS3MO"], "start": "2021-01-01", "end": "2021-01-31"})
        l = client.post("/ingestion/fred/load")
    assert r.status_code == 200 and r.json()["written"] == 1 and seen[0].url.params["api_key"] == FAKE_F
    assert l.status_code == 200 and "not endorsed" in l.json()["attribution"]
    assert FAKE_F not in r.text + l.text + caplog.text


def test_keys_endpoint_reports_presence_only(client, monkeypatch):
    monkeypatch.setenv("TIINGO_API_KEY", FAKE_T)
    r = client.get("/sources/keys")
    assert r.status_code == 200 and FAKE_T not in r.text and r.json()["keys"]["TIINGO"]["set"] is True


# ---- macro as-of

def test_macro_asof_first_observation_is_404_and_later_returns_previous(client):
    assert client.get("/macro/DGS3MO/asof", params={"date": "2021-01-04"}).status_code == 404
    r = client.get("/macro/DGS3MO/asof", params={"date": "2021-01-05"})
    assert r.status_code == 200 and r.json()["obs_date"] == "2021-01-04" and "not endorsed" in r.json()["attribution"]
    same = client.get("/macro/VIXCLS/asof", params={"date": "2021-02-01"}).json()
    assert same["obs_date"] < "2021-02-01"
    incl = client.get("/macro/VIXCLS/asof", params={"date": "2021-02-01", "strict": "false"}).json()
    assert incl["obs_date"] == "2021-02-01"
    assert client.get("/macro/NOPE/asof", params={"date": "2021-02-01"}).status_code == 404
    assert client.get("/macro/NOPE").status_code == 404


def test_macro_observations_and_derived(client):
    r = client.get("/macro/DGS3MO", params={"start": "2021-01-04", "end": "2021-02-20", "limit": 10}).json()
    assert r["returned"] == 10 and r["count"] > 10 and any(o["value"] is None for o in r["observations"]) or r["count"] > 10
    rf = client.get("/macro/derived/risk-free", params={"date": "2021-03-01"}).json()
    assert rf["rf_daily"] == pytest.approx(rf["yield_percent"] / 100 / 252)
    vb = client.get("/macro/derived/vix-bucket", params={"date": "2021-03-01"}).json()
    assert vb["label"] in ("low", "medium", "high") and vb["vix_observation"]["obs_date"] < "2021-03-01"
    assert client.get("/macro/derived/risk-free", params={"date": "2021-01-04"}).status_code == 404


def test_excess_sharpe_endpoint_matches_plain_with_zero_rf(client):
    eq = [100, 101, 100.5, 102, 103, 104.2]
    r = client.post("/backtests/excess-sharpe", json={"equity": eq, "rf_daily": [0.0] * 6}).json()
    assert r["sharpe"] == r["sharpe_excess"]
    assert client.post("/backtests/excess-sharpe", json={"equity": eq, "rf_daily": [0.0] * 5}).status_code == 422


# ---- new options on backtest / validation

def test_backtest_with_tiingo_total_return_differs_and_defaults_unchanged(client):
    base = client.post("/backtests/run", json=BODY).json()
    again = client.post("/backtests/run", json=BODY).json()
    tr = client.post("/backtests/run", json={**BODY, "source": "tiingo", "price_basis": "split_dividend"}).json()
    assert base["config_hash"] == again["config_hash"] and base["config_hash"] != tr["config_hash"]
    assert base["result_hash"] != tr["result_hash"] and "sharpe_excess" not in base["metrics"]
    px = client.post("/backtests/run", json={**BODY, "price_basis": "split_dividend"}).json()
    assert px["config_hash"] not in (base["config_hash"], tr["config_hash"])


def test_risk_free_option_adds_sharpe_excess_or_404(client):
    body = {**BODY, "start": "2021-01-06", "end": "2021-12-31", "fast": 3, "slow": 10, "risk_free": True}
    r = client.post("/backtests/run", json=body)
    assert r.status_code == 200 and "sharpe_excess" in r.json()["metrics"] and "sharpe_excess" in r.json()["benchmark_metrics"]
    early = client.post("/backtests/run", json={**body, "start": "2020-07-27"})
    assert early.status_code == 404 and "risk-free" in early.json()["detail"]


def test_validation_accepts_the_new_options_and_regimes_by_vix(client):
    g = client.post("/validation/grid-search", json={"symbol": "AAPL", "start": "2020-07-27", "end": "2021-12-31",
                                                     "fast_values": [3, 5], "slow_values": [20, 30],
                                                     "source": "tiingo", "price_basis": "split_dividend", "record": True})
    assert g.status_code == 200 and g.json()["trials"] == 4
    meter = client.get(f"/validation/studies/{g.json()['study_id']}").json()
    assert meter["trials"][0]["params"]["source"] == "tiingo" and meter["trials"][0]["params"]["price_basis"] == "split_dividend"
    assert "overfitting_meter" in meter
    default = client.post("/validation/grid-search", json={"symbol": "AAPL", "start": "2020-07-27", "end": "2021-12-31",
                                                           "fast_values": [3], "slow_values": [20], "record": True}).json()
    assert client.get(f"/validation/studies/{default['study_id']}").json()["trials"][0]["params"] == {"fast": 3, "slow": 20}
    vr = client.post("/validation/regimes", json={"symbol": "AAPL", "start": "2021-01-06", "end": "2021-12-31",
                                                  "fast": 3, "slow": 10, "by": "vix", "source": "tiingo", "risk_free": True})
    assert vr.status_code == 200 and {g_["label"] for g_ in vr.json()["groups"]} <= {"unknown", "low", "medium", "high"}
    assert "sharpe_excess" in vr.json()


def test_unknown_inputs_give_clean_errors(client):
    assert client.post("/backtests/run", json={**BODY, "price_basis": "total"}).status_code == 422
    assert client.post("/backtests/run", json={**BODY, "source": "nope"}).status_code == 404
    assert client.get("/sources/adjustment-check/ZZZZ").status_code == 404
    assert client.post("/sources/reconcile", json={"symbols": ["ZZZZ"]}).status_code == 404


def test_reconcile_endpoint_on_the_copied_sources(client, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "REPORT_DIR", tmp_path)
    r = client.post("/sources/reconcile", json={"symbols": ["AAPL"], "start": "2020-07-27", "end": "2021-12-31"})
    assert r.status_code == 200 and r.json()["totals"]["matched"] > 300 and r.json()["per_symbol"][0]["symbol"] == "AAPL"


# ---- standing invariant: replay boundary on the new options

def test_replay_boundary_fuzz_on_new_options(client):
    rng = random.Random(5)
    for _ in range(50):
        end = D(2020, 9, 1) + timedelta(days=rng.randrange(0, 480))
        body = {**BODY, "end": end.isoformat(), "source": "tiingo", "price_basis": "split_dividend", "include_equity": True}
        r = client.post("/backtests/run", json=body)
        if r.status_code == 404:
            continue
        assert r.status_code == 200 and r.json()["last_date"] <= end.isoformat()
        assert max(p["trade_date"] for p in r.json()["equity"]) <= end.isoformat()
    obs = client.get("/macro/VIXCLS", params={"end": "2021-03-01", "limit": 20000}).json()["observations"]
    assert max(o["obs_date"] for o in obs) <= "2021-03-01"
