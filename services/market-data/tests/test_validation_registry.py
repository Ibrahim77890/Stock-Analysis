"""Trial registry schema and the Sprint 04 data-window audit (task 04_01)."""

import re
from datetime import date

import psycopg
import pytest

from market_data import config
from market_data.read import list_instruments


def test_window_audit_table_matches_the_database():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c:
        rows = list_instruments(c)
    text = (config.DOCS_DIR / "02-domain" / "data-profile-v1.md").read_text(encoding="utf-8")
    block = text.split("<!-- window-audit:start -->")[1].split("<!-- window-audit:end -->")[0]
    doc = {m.group(1): (int(m.group(2)), m.group(3), m.group(4))
           for m in re.finditer(r"^\| (\S+) \| \S+ \| (\d+) \| (\S+) \| (\S+) \|$", block, re.M)}
    assert len(doc) == len(rows) == 53
    for r in rows:
        assert doc[r["symbol"]] == (r["bars"], str(r["first_date"]), str(r["last_date"]))


def test_phase_check_and_missing_study_are_rejected(conn):
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with conn.cursor() as cur:
            cur.execute("INSERT INTO research.trial (study_id, phase, params) VALUES (999, 'train', '{}')")
    conn.rollback()
    with conn.cursor() as cur:
        cur.execute("INSERT INTO research.study (name, family, symbol) VALUES ('s','sma_crossover','X') RETURNING study_id")
        sid = cur.fetchone()[0]
    with pytest.raises(psycopg.errors.CheckViolation):
        with conn.cursor() as cur:
            cur.execute("INSERT INTO research.trial (study_id, phase, params) VALUES (%s, 'other', '{}')", (sid,))
    conn.rollback()


def test_deleting_a_study_cascades_to_its_trials(conn):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO research.study (name, family, symbol) VALUES ('s','sma_crossover','X') RETURNING study_id")
        sid = cur.fetchone()[0]
        cur.execute("INSERT INTO research.trial (study_id, phase, params) VALUES (%s, 'train', '{}')", (sid,))
        cur.execute("DELETE FROM research.study WHERE study_id = %s", (sid,))
        cur.execute("SELECT count(*) FROM research.trial WHERE study_id = %s", (sid,))
        assert cur.fetchone()[0] == 0
    conn.rollback()
