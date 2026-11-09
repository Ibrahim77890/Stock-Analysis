import re
from datetime import date

import psycopg
import pytest

from market_data.core import config
from tests.market.test_replay_and_reads import _copy_upto

D = date


@pytest.fixture(autouse=True)
def no_internal_token_from_dotenv(monkeypatch):
    """The repository .env defines INTERNAL_API_TOKEN for the real stack; tests start from a clean slate and set it themselves."""
    monkeypatch.delenv("INTERNAL_API_TOKEN", raising=False)


@pytest.fixture(scope="session")
def real_aapl():
    """Read-only connection to the real database; skipped when Tiingo AAPL is not loaded."""
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


@pytest.fixture
def db(conn):
    """Throwaway database with empty research episode tables (synthetic episodes need nothing else)."""
    with conn.cursor() as cur:
        cur.execute("TRUNCATE research.prediction, research.episode CASCADE")
    conn.commit()
    return conn


@pytest.fixture
def db_real(db, real_aapl):
    """Throwaway database holding a copy of Tiingo AAPL (so real episodes can be created)."""
    _copy_upto(real_aapl, db, "AAPL", D(2021, 12, 31), source="tiingo")
    with db.cursor() as cur:
        cur.execute("TRUNCATE research.prediction, research.episode CASCADE")
    db.commit()
    return db


YEAR = re.compile(r"\b(200[5-9]|201\d|202[0-5])\b")
ISO_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def strings_of(obj):
    """All dictionary keys and string values of a JSON-like object (numbers are not returned)."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield str(k)
            yield from strings_of(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            yield from strings_of(v)
    elif isinstance(obj, str):
        yield obj
    elif isinstance(obj, date):
        yield obj.isoformat()


def identity_findings(obj, forbidden=("AAPL",)):
    """Identity strings in a response: symbol, year tokens, ISO dates (as whole words in keys and string values)."""
    found = []
    for s in strings_of(obj):
        low = s.lower()
        if any(f.lower() in low for f in forbidden):
            found.append(("symbol", s))
        if YEAR.search(s):
            found.append(("year", s))
        if ISO_DATE.search(s):
            found.append(("date", s))
    return found
