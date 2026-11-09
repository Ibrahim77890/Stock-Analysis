import json
import random
import subprocess
import sys
from datetime import date, timedelta

import httpx
import polars as pl
import psycopg
import pytest

from market_data.core import config
from market_data.ingestion import macro
from market_data.ingestion.macro import MacroError, asof_lookup, asof_series, download_fred, fred_fetch, load_fred, normalise_macro, parse_value
from market_data.market.read import get_macro, macro_asof

from tests.conftest import PROJECT_DIR

FAKE = "FREDKEY-ABC-123456"
D = date

# a holiday gap: Fri, Mon (holiday ".") , Tue
OBS = [{"date": "2021-12-30", "value": "0.05"}, {"date": "2021-12-31", "value": "0.06"},
       {"date": "2022-01-01", "value": "."}, {"date": "2022-01-03", "value": "0.07"},
       {"date": "2022-01-04", "value": "."}, {"date": "2022-01-05", "value": "0.09"}]


def fred_server(observations=OBS, status=200, echo_key=False):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if status != 200:
            body = f"bad request for {request.url}" if echo_key else "bad"
            return httpx.Response(status, text=body)
        sid = request.url.params["series_id"]
        return httpx.Response(200, json={"observations": observations, "series": sid})
    handler.calls = calls
    return handler


def make(server):
    return macro.make_client(httpx.MockTransport(server))


@pytest.fixture
def loaded(conn, tmp_path):
    srv = fred_server()
    download_fred(("DGS3MO",), "2021-12-30", "2022-01-05", data_dir=tmp_path, client=make(srv), sleep=lambda s: None)
    load_fred(conn, ("DGS3MO",), data_dir=tmp_path)
    return conn, tmp_path


# ---- pure rules

def test_parse_value_dot_is_none_not_zero():
    assert parse_value(".") is None and parse_value("") is None and parse_value("4.80") == 4.8
    with pytest.raises(ValueError):
        parse_value("abc")


def test_asof_lookup_strict_and_inclusive_skip_nulls():
    ds = [D(2021, 12, 31), D(2022, 1, 1), D(2022, 1, 3), D(2022, 1, 4)]
    vs = [0.06, None, 0.07, None]
    assert asof_lookup(ds, vs, D(2022, 1, 3)) == (D(2021, 12, 31), 0.06)          # strict: same-day value excluded, NULL skipped
    assert asof_lookup(ds, vs, D(2022, 1, 3), strict=False) == (D(2022, 1, 3), 0.07)
    assert asof_lookup(ds, vs, D(2022, 1, 5)) == (D(2022, 1, 3), 0.07)             # skips the NULL on 01-04
    with pytest.raises(LookupError):
        asof_lookup(ds, vs, D(2021, 12, 31))                                       # nothing earlier
    with pytest.raises(LookupError):
        asof_lookup(ds, [None] * 4, D(2022, 2, 1))


def test_normalise_rejects_garbage_and_keeps_dot_as_null():
    raw = pl.DataFrame([{"date": "2022-01-03", "value": "."}, {"date": "bad", "value": "1"},
                        {"date": "2022-01-04", "value": "x"}, {"date": "2022-01-05", "value": "1.5"},
                        {"date": "2022-01-05", "value": "1.6"}], schema=macro.RAW_SCHEMA)
    valid, rej = normalise_macro(raw, "S")
    assert valid["value"].to_list() == [None, 1.5] and sorted(rej["reason"].to_list()) == \
        ["bad_date", "duplicate_key", "non_numeric_value"]


# ---- database

def test_dot_stored_as_null_and_asof_skips_over_it(loaded):
    conn, _ = loaded
    df = get_macro(conn, "DGS3MO")
    assert df["value"].to_list() == [0.05, 0.06, None, 0.07, None, 0.09]
    assert macro_asof(conn, "DGS3MO", D(2022, 1, 5))["obs_date"] == D(2022, 1, 3)   # 01-04 is NULL, skipped
    assert macro_asof(conn, "DGS3MO", D(2022, 1, 4))["value"] == 0.07
    assert macro_asof(conn, "DGS3MO", D(2022, 1, 3))["obs_date"] == D(2021, 12, 31)  # holiday NULL skipped too
    assert macro_asof(conn, "DGS3MO", D(2022, 1, 3), strict=False)["obs_date"] == D(2022, 1, 3)


def test_asof_before_first_observation_raises(loaded):
    conn, _ = loaded
    with pytest.raises(LookupError):
        macro_asof(conn, "DGS3MO", D(2021, 12, 30))
    with pytest.raises(LookupError, match="unknown macro series"):
        macro_asof(conn, "NOPE", D(2022, 1, 5))
    with pytest.raises(LookupError):
        get_macro(conn, "NOPE")


def test_idempotent_load_and_reconciliation(loaded):
    conn, tmp = loaded
    second = load_fred(conn, ("DGS3MO",), data_dir=tmp)[0]
    assert second["inserted"] == 0 and second["updated"] == 0 and second["unchanged"] == 6
    with conn.cursor() as cur:
        cur.execute("SELECT kind, rows_read, rows_inserted + rows_updated + rows_unchanged + rows_rejected "
                    "FROM market.ingestion_job WHERE kind = 'macro'")
        rows = cur.fetchall()
    assert len(rows) == 2 and all(a == "macro" and b == c for a, b, c in rows)
    assert get_macro(conn, "DGS3MO").height == 6


def test_changed_value_is_updated_not_duplicated(loaded):
    conn, tmp = loaded
    changed = [dict(o) for o in OBS]
    changed[0]["value"] = "0.50"
    download_fred(("DGS3MO",), "2021-12-30", "2022-01-05", force=True, data_dir=tmp,
                  client=make(fred_server(changed)), sleep=lambda s: None)
    r = load_fred(conn, ("DGS3MO",), data_dir=tmp)[0]
    assert r["updated"] == 1 and r["inserted"] == 0
    assert get_macro(conn, "DGS3MO")["value"][0] == 0.5


def test_value_check_constraint_rejects_nonsense(conn):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO market.ingestion_job (kind, source, file_name, file_sha256, status) "
                    "VALUES ('macro','fred','f','h','running') RETURNING ingestion_job_id")
        jid = cur.fetchone()[0]
        with pytest.raises(psycopg.errors.CheckViolation):
            cur.execute("INSERT INTO market.macro_observation (series_id, obs_date, value, source, ingestion_job_id) "
                        "VALUES ('S', '2022-01-01', -5000, 'fred', %s)", (jid,))
    conn.rollback()


def test_migration_up_down_up_keeps_tables_and_head(test_db_url):
    env = {**__import__("os").environ, "DATABASE_URL": test_db_url}

    def alembic(*args):
        return subprocess.run([sys.executable, "-m", "alembic", *args], cwd=PROJECT_DIR, env=env,
                              capture_output=True, text=True, check=True).stdout

    def tables():
        with psycopg.connect(test_db_url) as c, c.cursor() as cur:
            cur.execute("SELECT table_schema || '.' || table_name FROM information_schema.tables "
                        "WHERE table_schema IN ('market','research') ORDER BY 1")
            return [r[0] for r in cur.fetchall()]

    before = tables()
    assert "market.macro_observation" in before
    alembic("downgrade", "0008")  # one before the macro migration (0009); later heads are re-applied below
    assert "market.macro_observation" not in tables()
    alembic("upgrade", "head")
    assert tables() == before and "0011" in alembic("heads")


# ---- keys

def test_fake_key_never_in_files_urls_or_exceptions(tmp_path, monkeypatch):
    monkeypatch.setenv("FRED_API_KEY", FAKE)
    srv = fred_server()
    out = download_fred(("DGS3MO", "VIXCLS"), "2021-12-30", "2022-01-05", data_dir=tmp_path, client=make(srv),
                        sleep=lambda s: None)
    assert out["written"] == 2 and srv.calls and all(c.url.params["api_key"] == FAKE for c in srv.calls)
    for p in tmp_path.rglob("*"):
        if p.is_file():
            assert FAKE.encode() not in p.read_bytes(), p
    man = json.loads((tmp_path / "raw" / "fred" / "DGS3MO.parquet.manifest.json").read_text())
    assert "api_key" not in json.dumps(man) and macro.ATTRIBUTION in man["license_note"]
    bad = fred_server(status=400, echo_key=True)
    with pytest.raises(MacroError) as e:
        fred_fetch("DGS3MO", "2021-12-30", client=make(bad), key=FAKE)
    assert FAKE not in str(e.value)


def test_download_is_idempotent(tmp_path):
    srv = fred_server()
    a = download_fred(("DGS3MO",), "2021-12-30", "2022-01-05", data_dir=tmp_path, client=make(srv))
    b = download_fred(("DGS3MO",), "2021-12-30", "2022-01-05", data_dir=tmp_path, client=make(srv))
    assert (a["written"], b["written"], b["skipped"], len(srv.calls)) == (1, 0, 1, 1)


# ---- real series (skipped if the real database is not loaded)

@pytest.fixture(scope="module")
def real_macro():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        try:
            cur.execute("SELECT count(*) FROM market.macro_observation WHERE series_id = 'DGS3MO'")
        except psycopg.Error:
            c.rollback()
            pytest.skip("macro table missing")
        if cur.fetchone()[0] < 1000:
            pytest.skip("real DGS3MO not loaded")
    yield c
    c.close()


def test_fuzz_strict_asof_never_returns_same_or_later_day(real_macro):
    rng = random.Random(7)
    lo, hi = D(2000, 1, 4), D(2025, 12, 31)
    for _ in range(200):
        d = lo + timedelta(days=rng.randrange((hi - lo).days + 1))
        for sid in ("DGS3MO", "VIXCLS"):
            r = macro_asof(real_macro, sid, d, strict=True)
            assert r["obs_date"] < d and r["value"] is not None
            r2 = macro_asof(real_macro, sid, d, strict=False)
            assert r["obs_date"] <= r2["obs_date"] <= d
    with pytest.raises(LookupError):
        macro_asof(real_macro, "DGS3MO", D(2000, 1, 3))


def test_db_asof_equals_pure_asof(real_macro):
    obs = get_macro(real_macro, "DGS3MO")
    dates = [D(2008, 9, 15), D(2020, 3, 16), D(2022, 6, 15), D(2025, 12, 31)]
    for strict in (True, False):
        assert asof_series(obs, dates, strict) == [macro_asof(real_macro, "DGS3MO", d, strict)["value"] for d in dates]
