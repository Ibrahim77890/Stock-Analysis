from datetime import date

import polars as pl
import pytest

from market_data import download_tiingo as dt
from market_data.load import (load_bars, load_corporate_actions, load_tiingo_universe, normalise_tiingo_actions,
                              normalise_tiingo_bars, upsert_instruments)
from market_data.manifest import write_manifest

from .conftest import make_bars


def rec(day, o, h, l, c, v=1000, div=0.0, split=1.0, adj=999.0):
    return {"date": f"{day}T00:00:00.000Z", "open": o, "high": h, "low": l, "close": c, "volume": v,
            "adjOpen": adj, "adjHigh": adj, "adjLow": adj, "adjClose": adj, "adjVolume": 7,
            "divCash": div, "splitFactor": split}


FIXTURE = [
    rec("2021-03-04", 120, 122, 119, 121),
    rec("2021-03-05", 121, 123, 120, 122, div=0.205),                         # dividend day
    rec("2020-08-31", 127, 131, 126, 129, split=4.0),                         # 4-for-1 split day (out of order on purpose)
    rec("2021-03-08", 122, 124, 0.0, 123),                                    # bad bar: low = 0
    rec("2021-03-04", 121, 122, 120, 121.5),                                  # duplicate date
]


def write_raw(tmp_path, symbol="AAPL", records=FIXTURE, name=None):
    d = tmp_path / "raw" / "tiingo" / "bars_1d"
    d.mkdir(parents=True, exist_ok=True)
    df = pl.DataFrame(records, schema=dt.RAW_SCHEMA)
    path = d / (name or f"{symbol}.parquet")
    df.write_parquet(path)
    write_manifest(path, provider="tiingo", endpoint="x", parameters={"symbol": symbol, "start": "a", "end": "b"},
                   row_count=df.height, license_note="test")
    return path


@pytest.fixture
def db(conn):
    uni = pl.DataFrame({"symbol": ["AAPL"], "name": ["Apple"], "type": ["stock"], "sector": ["Tech"]})
    upsert_instruments(conn, uni)
    return conn, uni


def test_normalise_ignores_adjusted_fields_and_takes_date_part():
    raw = pl.DataFrame(FIXTURE, schema=dt.RAW_SCHEMA)
    bars = normalise_tiingo_bars(raw, "AAPL")
    assert bars["close"].to_list()[0] == 121 and 999.0 not in bars["close"].to_list()
    assert bars["trade_date"].to_list()[0] == date(2021, 3, 4)
    assert normalise_tiingo_bars(pl.DataFrame([rec("2021-03-05", 1, 2, 1, 1.5)], schema=dt.RAW_SCHEMA), "X")["trade_date"][0] == date(2021, 3, 5)
    acts = normalise_tiingo_actions(raw, "AAPL")
    spl = acts.filter(pl.col("action_type") == "split")
    div = acts.filter(pl.col("action_type") == "dividend")
    assert spl.height == 1 and spl["split_to"][0] == 4.0 and spl["split_from"][0] == 1.0
    assert div.height == 1 and div["cash_amount"][0] == pytest.approx(0.205)


def test_load_stores_raw_close_quarantines_bad_and_duplicate(db, tmp_path):
    conn, _ = db
    path = write_raw(tmp_path)
    r = load_bars(conn, path)
    assert r["read"] == 5 and r["inserted"] == 3 and r["rejected"] == 2
    with conn.cursor() as cur:
        cur.execute("SELECT trade_date, close::float8, source FROM market.bar_daily ORDER BY trade_date")
        rows = cur.fetchall()
        assert [x[2] for x in rows] == ["tiingo"] * 3 and 999.0 not in [x[1] for x in rows]
        assert date(2021, 3, 8) not in [x[0] for x in rows]
        cur.execute("SELECT reason FROM market.bar_quarantine ORDER BY reason")
        assert sorted(x[0] for x in cur.fetchall()) == ["duplicate_key", "non_positive_price"]


def test_actions_loaded_and_job_reconciles(db, tmp_path):
    conn, _ = db
    path = write_raw(tmp_path)
    r = load_corporate_actions(conn, path)
    assert r["read"] == 2 and r["inserted"] == 2
    with conn.cursor() as cur:
        cur.execute("SELECT action_type, split_from::float8, split_to::float8, cash_amount::float8, source "
                    "FROM market.corporate_action ORDER BY ex_date")
        assert cur.fetchall() == [("split", 1.0, 4.0, None, "tiingo"), ("dividend", None, None, 0.205, "tiingo")]
        cur.execute("SELECT rows_read, rows_inserted + rows_updated + rows_unchanged + rows_rejected FROM market.ingestion_job")
        assert all(a == b for a, b in cur.fetchall())


def test_idempotent_and_alpaca_rows_untouched(db, tmp_path):
    conn, uni = db
    # an Alpaca row first
    from market_data.load import normalise_bars, validate_bars
    from market_data.manifest import write_manifest as wm
    ap = tmp_path / "raw" / "alpaca" / "bars_1d"
    ap.mkdir(parents=True)
    p = ap / "AAPL.parquet"
    make_bars("AAPL", [("2021-03-04", 120, 122, 119, 121, 500), ("2021-03-05", 121, 123, 120, 122, 600)]).write_parquet(p)
    wm(p, provider="alpaca", endpoint="x", parameters={"symbol": "AAPL"}, row_count=2, license_note="t")
    load_bars(conn, p)

    def alpaca_hash():
        with conn.cursor() as cur:
            cur.execute("SELECT md5(string_agg(t::text, '|' ORDER BY trade_date)) FROM "
                        "(SELECT instrument_id, trade_date, source, open, high, low, close, volume FROM market.bar_daily "
                        "WHERE source='alpaca') t")
            return cur.fetchone()[0]

    before = alpaca_hash()
    path = write_raw(tmp_path)
    first = load_bars(conn, path)
    second = load_bars(conn, path)
    assert first["inserted"] == 3 and second["inserted"] == 0 and second["updated"] == 0 and second["unchanged"] == 3
    a1, a2 = load_corporate_actions(conn, path), load_corporate_actions(conn, path)
    assert a1["inserted"] == 2 and a2["inserted"] == 0 and a2["updated"] == 0
    assert alpaca_hash() == before
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily")
        assert cur.fetchone()[0] == 5  # 2 alpaca + 3 tiingo, side by side


def test_load_universe_runs_both_and_skips_missing(db, tmp_path):
    conn, uni = db
    write_raw(tmp_path)
    out = load_tiingo_universe(conn, uni, data_dir=tmp_path)
    assert out[0]["bars"]["inserted"] == 3 and out[0]["actions"]["inserted"] == 2
    uni2 = pl.DataFrame({"symbol": ["AAPL", "ZZZ"], "name": ["a", "z"], "type": ["stock"] * 2, "sector": ["x"] * 2})
    out2 = load_tiingo_universe(conn, uni2, data_dir=tmp_path)
    assert out2[1] == {"symbol": "ZZZ", "skipped": "no raw file"}


def test_tampered_file_refused(db, tmp_path):
    conn, _ = db
    path = write_raw(tmp_path)
    path.write_bytes(path.read_bytes() + b"x")
    with pytest.raises(Exception, match="refusing to load"):
        load_bars(conn, path)


def test_raw_files_prefers_timestamped_over_plain(tmp_path):
    from market_data.download import raw_files
    for n in ("AAPL.parquet", "AAPL.20261108T101010Z.parquet", "AAPL.20261109T101010Z.parquet"):
        (tmp_path / n).write_bytes(b"")
    assert [p.name for p in raw_files(tmp_path, "AAPL")][-1] == "AAPL.20261109T101010Z.parquet"
