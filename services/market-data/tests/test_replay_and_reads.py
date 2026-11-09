"""Adjusted reads, replay cursor, truncation and structural tests (tasks 02_03, 02_04)."""

import random
import re
from datetime import date, timedelta
from pathlib import Path

import polars as pl
import psycopg
import pytest

from market_data import config
from market_data.adjust import adjust_bars
from market_data.read import get_actions, get_bars, session_dates
from market_data.replay import blind_view, new_session, visible_bars

D = date
SRC = Path(__file__).resolve().parents[1] / "src" / "market_data"
ALLOWED_SQL_MODULES = {"read.py", "load.py", "quality.py"}  # load writes; quality has its own checks


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


# ---- structural: single choke point

def offenders(src_dir: Path) -> list[str]:
    pat = re.compile(r"(FROM|JOIN|INTO|UPDATE|TRUNCATE)\s+market\.bar_daily", re.I)
    return sorted(p.name for p in src_dir.glob("*.py")
                  if p.name not in ALLOWED_SQL_MODULES and pat.search(p.read_text(encoding="utf-8")))


def test_only_allowed_modules_query_bar_daily():
    assert offenders(SRC) == []


def test_structural_test_detects_a_new_offending_module(tmp_path):
    (tmp_path / "sneaky.py").write_text('SQL = "SELECT * FROM market.bar_daily"')
    (tmp_path / "read.py").write_text('SQL = "SELECT * FROM market.bar_daily"')
    assert offenders(tmp_path) == ["sneaky.py"]


# ---- adjusted reads (02_03)

def test_aapl_factors_and_pre_split_cursor(real):
    df = get_bars(real, "AAPL", D(2020, 8, 25), D(2020, 9, 4), adjustment="split")
    before = df.filter(pl.col("trade_date") < D(2020, 8, 31))
    after = df.filter(pl.col("trade_date") >= D(2020, 8, 31))
    assert set(before["factor"]) == {0.25} and set(after["factor"]) == {1.0}
    early = get_bars(real, "AAPL", D(2020, 8, 25), D(2020, 9, 4), max_date=D(2020, 8, 28), adjustment="split")
    raw = get_bars(real, "AAPL", D(2020, 8, 25), D(2020, 8, 28))
    assert early["close"].to_list() == raw["close"].to_list() and set(early["factor"]) == {1.0}


def test_bad_adjustment_and_raw_shape_unchanged(real):
    with pytest.raises(ValueError):
        get_bars(real, "AAPL", D(2020, 1, 1), D(2020, 2, 1), adjustment="bogus")
    raw = get_bars(real, "AAPL", D(2020, 8, 25), D(2020, 9, 4))
    assert raw.columns == ["trade_date", "open", "high", "low", "close", "volume"] and raw.height == 9


def _copy_upto(real, test_conn, symbol, upto, source="alpaca", reset=True):
    """Copy a symbol's bars and actions of one source dated <= upto into the throwaway test database.

    reset=False keeps what is already there (used to copy a second source next to the first)."""
    with test_conn.cursor() as cur:
        if reset:
            cur.execute("TRUNCATE market.bar_daily, market.corporate_action, market.ingestion_job, market.instrument "
                        "RESTART IDENTITY CASCADE")
            cur.execute("INSERT INTO market.instrument (symbol,name,asset_type) VALUES (%s,%s,'stock') RETURNING instrument_id",
                        (symbol, symbol))
        else:
            cur.execute("SELECT instrument_id FROM market.instrument WHERE symbol=%s", (symbol,))
        iid = cur.fetchone()[0]
        cur.execute("INSERT INTO market.ingestion_job (kind,source,file_name,file_sha256,status) VALUES "
                    "('bars',%s,'x','x','succeeded') RETURNING ingestion_job_id", (source,))
        jid = cur.fetchone()[0]
        with real.cursor() as rc:
            rc.execute("SELECT b.trade_date,b.open,b.high,b.low,b.close,b.volume FROM market.bar_daily b "
                       "JOIN market.instrument i USING (instrument_id) WHERE i.symbol=%s AND b.trade_date<=%s "
                       "AND b.source=%s", (symbol, upto, source))
            rows = rc.fetchall()
            rc.execute("SELECT a.action_type,a.ex_date,a.split_from,a.split_to,a.cash_amount FROM market.corporate_action a "
                       "JOIN market.instrument i USING (instrument_id) WHERE i.symbol=%s AND a.ex_date<=%s "
                       "AND a.source=%s", (symbol, upto, source))
            acts = rc.fetchall()
        cur.executemany("INSERT INTO market.bar_daily (instrument_id,trade_date,source,open,high,low,close,volume,ingestion_job_id) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        [(iid, r[0], source, r[1], r[2], r[3], r[4], r[5], jid) for r in rows])
        cur.executemany("INSERT INTO market.corporate_action (instrument_id,action_type,ex_date,split_from,split_to,cash_amount,source,ingestion_job_id) "
                        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", [(iid, *a, source, jid) for a in acts])
    test_conn.commit()


def test_truncation_adjusted_read_equals_read_from_truncated_database(real, conn):
    """A database cut at D and the full database give identical adjusted bars as of D."""
    rng = random.Random(5)
    start = D(2019, 1, 1)
    for _ in range(20):
        cut = D(2020, 1, 1) + timedelta(days=rng.randrange(0, 1500))
        _copy_upto(real, conn, "AAPL", cut)
        truncated = get_bars(conn, "AAPL", start, cut, adjustment="split_dividend")
        full = get_bars(real, "AAPL", start, D(2025, 12, 31), max_date=cut, adjustment="split_dividend")
        assert full.equals(truncated), cut


def test_leaky_adjuster_differs_from_truncated_database(real, conn):
    cut = D(2020, 8, 20)  # before the AAPL split
    _copy_upto(real, conn, "AAPL", cut)
    honest = get_bars(conn, "AAPL", D(2020, 8, 1), cut, adjustment="split")
    hist = get_bars(real, "AAPL", D(2016, 1, 1), cut)
    leaky = adjust_bars(hist, get_actions(real, "AAPL"), D(2025, 12, 31), "split").filter(
        (pl.col("trade_date") >= D(2020, 8, 1)) & (pl.col("trade_date") <= cut))
    assert honest["close"].to_list() != leaky["close"].to_list()


# ---- replay (02_04)

def test_fuzz_cursor_bound_for_200_random_cursors(real):
    rng = random.Random(42)
    for _ in range(200):
        sym = rng.choice(["AAPL", "NVDA", "TSLA", "SPY", "GE"])
        dates = session_dates(real, sym, D(2016, 1, 1))
        s = new_session(real, sym, dates[0])
        s.cursor = dates[rng.randrange(0, len(dates))]
        for adj in ("raw", "split", "split_dividend"):
            out = visible_bars(real, s, adj)
            assert out.height == 0 or out["trade_date"].max() <= s.cursor, (sym, s.cursor, adj)


def test_session_cursor_moves_forward_only_and_clamps(real):
    s = new_session(real, "AAPL", D(2020, 8, 25))
    first = s.cursor
    assert s.advance(real, 3) > first
    with pytest.raises(ValueError):
        s.advance(real, 0)
    with pytest.raises(ValueError):
        s.advance(real, -2)
    last = session_dates(real, "AAPL", D(2020, 8, 25))[-1]
    s.advance(real, 10**6)
    assert s.cursor == last
    assert s.advance(real, 1) == last  # stays at the last stored session


def test_visible_bars_ignore_dates_after_cursor(real):
    s = new_session(real, "AAPL", D(2020, 8, 25))
    s.advance(real, 2)
    out = visible_bars(real, s, "split")
    assert out["trade_date"].max() == s.cursor and out.height == 3


def test_blind_view_hides_identity_and_rebases_to_100(real):
    s = new_session(real, "AAPL", D(2020, 8, 25))
    s.advance(real, 8)
    adj = visible_bars(real, s, "split")
    b = blind_view(adj)
    assert b.columns == ["day", "open", "high", "low", "close", "volume"]
    assert b["close"][0] == pytest.approx(100.0) and b["day"].to_list() == list(range(1, adj.height + 1))
    assert b["close"].pct_change().drop_nulls().to_list() == pytest.approx(adj["close"].pct_change().drop_nulls().to_list())
    assert blind_view(adj.head(0)).height == 0
