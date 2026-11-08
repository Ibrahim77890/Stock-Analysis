"""Shared fixtures. Database tests need TEST_DATABASE_URL (a throwaway database that
tests may wipe) and are skipped when it is not set or not reachable."""

import os
import subprocess
import sys
from pathlib import Path

import polars as pl
import psycopg
import pytest

PROJECT_DIR = Path(__file__).resolve().parents[1]


def make_bars(symbol: str, rows: list[tuple]) -> pl.DataFrame:
    """rows: (iso_date, o, h, l, c, v) -> raw Alpaca-shaped frame (t, o, h, l, c, v, n, vw)."""
    return pl.DataFrame(
        {
            "t": [f"{r[0]}T12:00:00Z" for r in rows], "o": [r[1] for r in rows], "h": [r[2] for r in rows],
            "l": [r[3] for r in rows], "c": [r[4] for r in rows], "v": [r[5] for r in rows],
            "n": [100] * len(rows), "vw": [r[4] for r in rows],
        },
        schema={"t": pl.String, "o": pl.Float64, "h": pl.Float64, "l": pl.Float64,
                "c": pl.Float64, "v": pl.Int64, "n": pl.Int64, "vw": pl.Float64},
    )


@pytest.fixture(scope="session")
def test_db_url():
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set; database tests skipped")
    try:
        psycopg.connect(url, connect_timeout=3).close()
    except psycopg.OperationalError as exc:
        pytest.skip(f"test database unreachable: {exc}")
    env = {**os.environ, "DATABASE_URL": url}
    for cmd in (["downgrade", "base"], ["upgrade", "head"]):
        subprocess.run([sys.executable, "-m", "alembic", *cmd], cwd=PROJECT_DIR, env=env, check=True)
    return url


@pytest.fixture
def conn(test_db_url):
    c = psycopg.connect(test_db_url)
    with c.cursor() as cur:
        cur.execute("TRUNCATE market.data_quality_result, market.bar_quarantine, market.bar_daily, "
                    "market.corporate_action, market.ingestion_job, market.instrument RESTART IDENTITY CASCADE")
    c.commit()
    yield c
    c.close()
