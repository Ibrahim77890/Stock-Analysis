"""Fixtures for the Strategy Lab tests: a throwaway database with one crafted random-walk stock of 3,600 sessions."""

from datetime import date, timedelta

import numpy as np
import pytest

SYMBOL = "TESTX"
N_BARS = 3600


@pytest.fixture(autouse=True)
def no_internal_token_from_dotenv(monkeypatch):
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)


def session_days(n: int, start: date = date(2005, 1, 3)) -> list[date]:
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def seed_symbol(conn, symbol: str = SYMBOL, n: int = N_BARS, seed: int = 7, source: str = "tiingo",
                splits: tuple = ()) -> list[date]:
    """Insert a random-walk stock. `splits` = ((session_index, from, to), ...): raw prices before the ex-date are
    multiplied by to/from the way a vendor leaves them (unadjusted)."""
    rng = np.random.default_rng(seed)
    days = session_days(n)
    close = 100 * np.exp(np.cumsum(rng.normal(0.0003, 0.012, n)))
    open_ = close * np.exp(rng.normal(0, 0.002, n))
    high = np.maximum(open_, close) * 1.004
    low = np.minimum(open_, close) * 0.996
    raw = np.stack([open_, high, low, close]).copy()
    for idx, f, t in splits:
        raw[:, :idx] *= t / f
    with conn.cursor() as cur:
        cur.execute("TRUNCATE research.lab_study, research.trial, research.study RESTART IDENTITY CASCADE")
        cur.execute("INSERT INTO market.instrument (symbol,name,asset_type) VALUES (%s,%s,'stock') RETURNING instrument_id",
                    (symbol, "Test stock"))
        iid = cur.fetchone()[0]
        cur.execute("INSERT INTO market.ingestion_job (kind,source,file_name,file_sha256,status) VALUES "
                    "('bars',%s,'x','x','succeeded') RETURNING ingestion_job_id", (source,))
        jid = cur.fetchone()[0]
        cur.executemany(
            "INSERT INTO market.bar_daily (instrument_id,trade_date,source,open,high,low,close,volume,ingestion_job_id) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            [(iid, days[i], source, float(raw[0, i]), float(raw[1, i]), float(raw[2, i]), float(raw[3, i]), 1000, jid)
             for i in range(n)])
        for idx, f, t in splits:
            cur.execute("INSERT INTO market.corporate_action (instrument_id,action_type,ex_date,split_from,split_to,source,ingestion_job_id) "
                        "VALUES (%s,'split',%s,%s,%s,%s,%s)", (iid, days[idx], f, t, source, jid))
    conn.commit()
    return days


@pytest.fixture
def lab_db(conn):
    seed_symbol(conn)
    return conn
