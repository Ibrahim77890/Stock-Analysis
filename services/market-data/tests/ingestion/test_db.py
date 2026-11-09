"""Database tests: run only with TEST_DATABASE_URL pointing at a throwaway database."""

import hashlib
from datetime import date

import polars as pl
import pytest

from market_data.ingestion import quality as q
from market_data.ingestion.load import LoadError, load_bars, load_corporate_actions, upsert_instruments
from market_data.core.manifest import write_manifest
from market_data.market.read import UnknownSymbolError, get_bars
from tests.conftest import make_bars

UNIVERSE = pl.DataFrame({"symbol": ["AAA", "BBB"], "name": ["A", "B"], "type": ["stock", "etf"],
                         "sector": ["x", "y"], "reason_included": ["t", "t"]})
ROWS = [(f"2020-01-{d:02d}", 10.0 + d, 12.0 + d, 9.0 + d, 11.0 + d, 100 + d) for d in (2, 3, 6, 7, 8)]


def write_raw(tmp_path, df, name="AAA.parquet", symbol="AAA"):
    path = tmp_path / name
    df.write_parquet(path)
    write_manifest(path, provider="alpaca", endpoint="test", parameters={"symbol": symbol},
                   row_count=df.height, license_note="test")
    return path


@pytest.fixture
def loaded(conn, tmp_path):
    upsert_instruments(conn, UNIVERSE)
    path = write_raw(tmp_path, make_bars("AAA", ROWS))
    return conn, path, load_bars(conn, path)


def checksum(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT count(*), md5(string_agg(instrument_id||'|'||trade_date||'|'||open||'|'||high||'|'"
                    "||low||'|'||close||'|'||volume, ',' ORDER BY instrument_id, trade_date)) FROM market.bar_daily")
        return cur.fetchone()


def test_idempotent_load(loaded):
    conn, path, first = loaded
    assert first["inserted"] == 5
    before = checksum(conn)
    second = load_bars(conn, path)
    assert checksum(conn) == before
    assert second["inserted"] == 0 and second["updated"] == 0 and second["unchanged"] == 5


def test_revision_updates_exactly_one_row(loaded, tmp_path):
    conn, _, _ = loaded
    changed = [ROWS[0][:4] + (11.5,) + ROWS[0][5:]] + ROWS[1:]
    path = write_raw(tmp_path, make_bars("AAA", changed), "AAA.rev.parquet")
    res = load_bars(conn, path)
    assert (res["updated"], res["unchanged"], res["inserted"]) == (1, 4, 0)


def test_quarantine_three_bad_rows_with_distinct_reasons(conn, tmp_path):
    upsert_instruments(conn, UNIVERSE)
    good = make_bars("AAA", ROWS[:2]).with_columns(pl.lit("AAA").alias("symbol"))
    bad = make_bars("AAA", [("2020-01-09", 10.0, 9.0, 8.0, 10.5, 5),    # high < close
                            ("2020-01-10", 10.0, 11.0, 9.0, 10.5, -5),  # negative volume
                            ("2020-01-13", 10.0, 11.0, 9.0, 10.5, 5)])
    bad = bad.with_columns(pl.Series("symbol", ["AAA", "AAA", "ZZZ"]))   # unknown symbol on the last
    path = write_raw(tmp_path, pl.concat([good, bad]), "mixed.parquet")
    res = load_bars(conn, path)
    assert res["rejected"] == 3 and res["inserted"] == 2
    with conn.cursor() as cur:
        cur.execute("SELECT reason FROM market.bar_quarantine ORDER BY reason")
        assert [r[0] for r in cur.fetchall()] == ["high_below_ohlc", "negative_volume", "unknown_symbol"]


def test_failure_rolls_back_and_marks_job_failed(conn, tmp_path):
    upsert_instruments(conn, UNIVERSE)
    path = write_raw(tmp_path, make_bars("AAA", ROWS))
    with pytest.raises(LoadError):
        load_bars(conn, path, batch_size=2, fail_after_batches=1)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily")
        assert cur.fetchone()[0] == 0
        cur.execute("SELECT status, error FROM market.ingestion_job")
        status, error = cur.fetchone()
    assert status == "failed" and "simulated" in error


def test_reconciliation_holds_for_every_job(loaded):
    conn, path, _ = loaded
    load_bars(conn, path)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.ingestion_job WHERE status='succeeded' AND "
                    "rows_read <> rows_inserted + rows_updated + rows_unchanged + rows_rejected")
        assert cur.fetchone()[0] == 0


def test_tampered_file_refused(conn, tmp_path):
    upsert_instruments(conn, UNIVERSE)
    path = write_raw(tmp_path, make_bars("AAA", ROWS))
    data = bytearray(path.read_bytes())
    data[len(data) // 2] ^= 0xFF
    path.write_bytes(bytes(data))
    with pytest.raises(LoadError, match="hash mismatch"):
        load_bars(conn, path)
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.ingestion_job")
        assert cur.fetchone()[0] == 0  # refused before any job started


def test_corporate_actions_idempotent(conn, tmp_path):
    upsert_instruments(conn, UNIVERSE)
    raw = pl.DataFrame({"action_type": ["forward_split", "cash_dividend"], "symbol": ["AAA", "AAA"],
                        "ex_date": ["2020-08-31", "2020-02-01"], "new_rate": [4.0, None],
                        "old_rate": [1.0, None], "rate": [None, 0.5]})
    path = write_raw(tmp_path, raw, "ca.parquet")
    assert load_corporate_actions(conn, path)["inserted"] == 2
    again = load_corporate_actions(conn, path)
    assert (again["inserted"], again["updated"], again["unchanged"]) == (0, 0, 2)


def test_get_bars_range_max_date_and_errors(loaded):
    conn, _, _ = loaded
    df = get_bars(conn, "AAA", date(2020, 1, 3), date(2020, 1, 7))
    assert [str(d) for d in df["trade_date"]] == ["2020-01-03", "2020-01-06", "2020-01-07"]
    assert df["volume"][0] == 103
    assert get_bars(conn, "AAA", date(2021, 1, 1), date(2021, 2, 1)).height == 0
    with pytest.raises(UnknownSymbolError):
        get_bars(conn, "NOPE", date(2020, 1, 1), date(2020, 2, 1))
    with pytest.raises(ValueError):
        get_bars(conn, "AAA", date(2020, 2, 1), date(2020, 1, 1))
    import random
    rng = random.Random(7)
    for _ in range(100):
        cutoff = date(2020, 1, rng.randint(1, 31))
        got = get_bars(conn, "AAA", date(2020, 1, 1), date(2020, 1, 31), max_date=cutoff)
        assert all(d <= cutoff for d in got["trade_date"])


def test_quality_run_is_deterministic_and_read_only(loaded, tmp_path):
    conn, _, _ = loaded
    before = checksum(conn)
    a = q.run_quality(conn, report_dir=tmp_path)
    b = q.run_quality(conn, report_dir=tmp_path)
    assert a["totals_per_rule"] == b["totals_per_rule"]
    assert checksum(conn) == before
    assert (tmp_path / f"quality-report-{a['run_id']}.md").exists()


def test_deleted_day_reported_as_provider_gap(conn, tmp_path):
    upsert_instruments(conn, UNIVERSE)
    days = [date(2023, 11, d) for d in (20, 21, 22, 24, 27)]  # 23rd is Thanksgiving
    rows = [(d.isoformat(), 10.0, 11.0, 9.0, 10.5, 100) for d in days if d != date(2023, 11, 21)]
    load_bars(conn, write_raw(tmp_path, make_bars("AAA", rows)))
    rep = q.run_quality(conn, report_dir=tmp_path)
    assert rep["totals_per_rule"]["missing_session"] == 1
    assert rep["missing_session_classification"] == {"provider_gap": 1}
