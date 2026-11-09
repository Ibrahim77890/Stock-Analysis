import json
import os
import re
import subprocess
import sys
from pathlib import Path

import polars as pl
import psycopg
import pytest

from market_data.lab import study as L
from market_data.lab.study import HoldoutAlreadyUsedError, LabLimitError
from market_data.market import read as read_mod
from tests.conftest import PROJECT_DIR
from tests.lab.conftest import N_BARS, SYMBOL, seed_symbol

ISO = re.compile(r"\d{4}-\d{2}-\d{2}")
FAST = dict(fast=10, slow=40, cost_bps=2.0, seed=1, n_paths=10)


def counts(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT (SELECT count(*) FROM research.study), (SELECT count(*) FROM research.trial), "
                    "(SELECT count(*) FROM research.lab_study)")
        return cur.fetchone()


def make(conn, **kw):
    return L.create_lab_study(conn, SYMBOL, **kw)["study_id"]


def dates_in(obj):
    return ISO.findall(json.dumps(obj, default=str))


# ---- migration

def test_migration_0012_up_down_up(test_db_url):
    env = {**os.environ, "DATABASE_URL": test_db_url}

    def alembic(*a):
        return subprocess.run([sys.executable, "-m", "alembic", *a], cwd=PROJECT_DIR, env=env, capture_output=True, text=True, check=True).stdout

    def tables():
        with psycopg.connect(test_db_url) as c, c.cursor() as cur:
            cur.execute("SELECT table_schema || '.' || table_name FROM information_schema.tables WHERE table_schema IN ('market','research') ORDER BY 1")
            return [r[0] for r in cur.fetchall()]

    before = tables()
    assert "research.lab_study" in before
    alembic("downgrade", "0011")
    assert "research.lab_study" not in tables()
    alembic("upgrade", "head")
    assert tables() == before and "0012" in alembic("heads")


# ---- list and create

def test_eligible_symbols_need_3000_sessions(lab_db):
    assert [s["symbol"] for s in L.eligible_symbols(lab_db)] == [SYMBOL]
    seed_symbol(lab_db, "SHORT", n=2999)
    assert [s["symbol"] for s in L.eligible_symbols(lab_db)] == [SYMBOL]  # SHORT is listed nowhere
    with pytest.raises(LabLimitError, match="at least 3,000"):
        L.create_lab_study(lab_db, "SHORT")


def test_create_returns_sizes_without_vault_dates(lab_db):
    out = L.create_lab_study(lab_db, SYMBOL)
    assert out["practice_bars"] == N_BARS - 1000 - L.EMBARGO and out["vault_bars"] == 1000 and out["vault_open"] is False
    assert dates_in(out) == []
    with pytest.raises(LabLimitError):
        L.create_lab_study(lab_db, SYMBOL, vault_bars=100)
    with pytest.raises(read_mod.UnknownSymbolError):
        L.create_lab_study(lab_db, "NOPE")


# ---- practice runs

def test_practice_result_shape_and_no_vault_dates(lab_db):
    days_all = [d.isoformat() for d in __import__("tests.lab.conftest", fromlist=["session_days"]).session_days(N_BARS)]
    sid = make(lab_db)
    with lab_db.cursor() as cur:
        cur.execute("SELECT practice_end FROM research.lab_study WHERE study_id=%s", (sid,))
        practice_end = cur.fetchone()[0]
    r = L.run_practice(lab_db, sid, **FAST)
    assert all(d <= practice_end.isoformat() for d in dates_in(r))
    assert any(d > practice_end.isoformat() for d in days_all)  # the vault exists, and none of it is in the result
    g = r["growth"]
    assert g["rule"][0] == 100 == g["buy_hold"][0] and len(g["dates"]) <= 300
    assert g["dates"][-1] == practice_end.isoformat() and g["dates"][0] == days_all[0]
    assert [c["cost_bps"] for c in r["costs"]] == [0, 2, 5, 10, 20]
    assert set(r["rule"]) == set(L.METRIC_KEYS) and r["counted"] is True and r["trial_count"] == 1
    assert 0 <= r["luck"]["fraction_as_good"] <= 1 and r["luck"]["n_paths"] == 10
    assert r["yearly"][0]["year"] == 2005


def test_practice_does_not_depend_on_vault_rows(lab_db):
    sid = make(lab_db)
    first = L.run_practice(lab_db, sid, **FAST)
    with lab_db.cursor() as cur:
        cur.execute("SELECT practice_end FROM research.lab_study WHERE study_id=%s", (sid,))
        pe = cur.fetchone()[0]
        cur.execute("DELETE FROM market.bar_daily WHERE trade_date > %s", (pe,))
    lab_db.commit()
    again = L.run_practice(lab_db, sid, **FAST)
    for k in ("rule", "buy_hold", "growth", "yearly", "costs", "luck", "config_hash"):
        assert json.dumps(first[k], sort_keys=True) == json.dumps(again[k], sort_keys=True), k


def test_practice_only_requests_bars_up_to_practice_end(lab_db, monkeypatch):
    sid = make(lab_db)
    with lab_db.cursor() as cur:
        cur.execute("SELECT practice_end FROM research.lab_study WHERE study_id=%s", (sid,))
        pe = cur.fetchone()[0]
    seen = []
    real = L.get_bars
    monkeypatch.setattr(L, "get_bars", lambda conn, sym, start, end, **kw: (seen.append(end), real(conn, sym, start, end, **kw))[1])
    L.run_practice(lab_db, sid, **FAST)
    assert seen and max(seen) == pe


def test_adjustment_is_as_of_practice_end(conn):
    days = seed_symbol(conn, splits=((N_BARS - 300, 1, 2),))  # a 2-for-1 split inside the vault
    sid = make(conn)
    full = L.run_practice(conn, sid, **FAST)
    # a database that ends at the practice end (no vault, no split) gives the same practice numbers
    with conn.cursor() as cur:
        cur.execute("SELECT practice_end FROM research.lab_study WHERE study_id=%s", (sid,))
        pe = cur.fetchone()[0]
        cur.execute("DELETE FROM market.bar_daily WHERE trade_date > %s", (pe,))
        cur.execute("DELETE FROM market.corporate_action")
    conn.commit()
    cut = L.run_practice(conn, sid, **FAST)
    assert days[N_BARS - 300] > pe
    assert json.dumps(full["growth"]) == json.dumps(cut["growth"]) and full["rule"] == cut["rule"]


def test_trials_are_counted_and_repeats_are_not(lab_db):
    sid = make(lab_db)
    a = L.run_practice(lab_db, sid, fast=5, slow=20, cost_bps=2, seed=1, n_paths=10)
    for fast, slow in ((10, 40), (8, 30), (12, 60), (3, 15)):
        L.run_practice(lab_db, sid, fast=fast, slow=slow, cost_bps=2, seed=1, n_paths=10)
    assert L.study_overview(lab_db, sid)["ideas_tried"] == 5
    rep = L.run_practice(lab_db, sid, fast=5, slow=20, cost_bps=2.0, seed=1, n_paths=10)
    assert rep["counted"] is False and rep["trial_count"] == 5 and rep["rule"] == a["rule"] and rep["config_hash"] == a["config_hash"]
    other_cost = L.run_practice(lab_db, sid, fast=5, slow=20, cost_bps=5, seed=1, n_paths=10)
    assert other_cost["counted"] is True and other_cost["trial_count"] == 6
    assert other_cost["config_hash"] != a["config_hash"] and other_cost["overfitting_meter"]["trials"] == 6
    with lab_db.cursor() as cur:
        cur.execute("SELECT count(*) FROM research.trial WHERE study_id=%s", (sid,))
        assert cur.fetchone()[0] == 6


def test_same_seed_same_json_and_hash_changes_with_the_rule(lab_db):
    sid = make(lab_db)
    a = L.run_practice(lab_db, sid, **FAST)
    b = L.run_practice(lab_db, sid, **FAST)
    assert json.dumps({k: v for k, v in a.items() if k not in ("counted",)}, sort_keys=True, default=str) == \
        json.dumps({k: v for k, v in b.items() if k not in ("counted",)}, sort_keys=True, default=str)
    hashes = {L.run_practice(lab_db, sid, **{**FAST, **kw})["config_hash"] for kw in ({}, {"fast": 11}, {"slow": 41}, {"cost_bps": 3.0})}
    assert len(hashes) == 4


@pytest.mark.parametrize("kw", [
    dict(fast=40, slow=40), dict(fast=50, slow=10), dict(fast=1, slow=10), dict(fast=5, slow=301),
    dict(fast=5, slow=20, cost_bps=51), dict(fast=5, slow=20, cost_bps=-1), dict(fast=5, slow=20, n_paths=201),
    dict(fast=5, slow=20, n_paths=5)])
def test_caps_reject_and_change_nothing(lab_db, kw):
    sid = make(lab_db)
    before = counts(lab_db)
    with pytest.raises(LabLimitError):
        L.run_practice(lab_db, sid, **{"cost_bps": 2.0, "seed": 1, "n_paths": 10, **kw})
    assert counts(lab_db) == before


def test_the_201st_trial_is_refused_but_a_repeat_is_not(lab_db, monkeypatch):
    monkeypatch.setattr(L, "MAX_TRIALS", 3)
    sid = make(lab_db)
    for slow in (20, 21, 22):
        L.run_practice(lab_db, sid, fast=5, slow=slow, n_paths=10)
    before = counts(lab_db)
    with pytest.raises(LabLimitError, match="at most 3"):
        L.run_practice(lab_db, sid, fast=5, slow=23, n_paths=10)
    assert counts(lab_db) == before
    assert L.run_practice(lab_db, sid, fast=5, slow=22, n_paths=10)["counted"] is False


def test_unknown_study(lab_db):
    with pytest.raises(L.LabStudyNotFound):
        L.run_practice(lab_db, 999, **FAST)
    with pytest.raises(L.LabStudyNotFound):
        L.study_overview(lab_db, 999)


# ---- vault

def test_overview_before_the_vault_has_no_dates_or_vault_numbers(lab_db):
    sid = make(lab_db)
    L.run_practice(lab_db, sid, **FAST)
    o = L.study_overview(lab_db, sid)
    assert o["vault_open"] is False and dates_in({k: v for k, v in o.items() if k != "created_at"}) == []
    assert o["trials"][0]["fast"] == 10 and o["ideas_tried"] == 1
    with pytest.raises(LabLimitError, match="not been opened"):
        L.vault_result(lab_db, sid)


def test_vault_needs_a_practice_run_and_opens_only_once(lab_db):
    sid = make(lab_db)
    with pytest.raises(LabLimitError, match="Run this exact rule"):
        L.open_vault(lab_db, sid, 10, 40, 2.0)
    L.run_practice(lab_db, sid, **FAST)
    v = L.open_vault(lab_db, sid, 10, 40, 2.0)
    assert v["vault_bars"] == 1000 and v["ideas_tried"] == 1 and abs(v["growth"]["rule"][0] - 100) < 3
    assert v["practice"]["rule"]["trades"] is not None and v["practice"]["buy_hold"]["trades"] == 1 and v["practice"]["years"] > 0 and len(v["growth"]["dates"]) <= 300
    before = counts(lab_db)
    with pytest.raises(HoldoutAlreadyUsedError):
        L.open_vault(lab_db, sid, 10, 40, 2.0)
    with pytest.raises(HoldoutAlreadyUsedError):
        L.open_vault(lab_db, sid, 5, 20, 2.0)
    assert counts(lab_db) == before
    saved = L.vault_result(lab_db, sid)
    assert saved["rule"] == v["rule"] and saved["buy_hold"] == v["buy_hold"] and saved["params"] == v["params"]
    assert L.study_overview(lab_db, sid)["vault_open"] is True
    with lab_db.cursor() as cur:
        cur.execute("SELECT phase FROM research.trial WHERE study_id=%s ORDER BY trial_id", (sid,))
        assert [r[0] for r in cur.fetchall()] == ["train", "holdout"]


def test_vault_starts_after_the_embargo_and_matches_a_hand_run(lab_db):
    from market_data.backtesting.backtest import BacktestSpec, run_backtest
    from market_data.backtesting.metrics import summarise

    sid = make(lab_db)
    L.run_practice(lab_db, sid, **FAST)
    v = L.open_vault(lab_db, sid, 10, 40, 2.0)
    bars = read_mod.get_bars(lab_db, SYMBOL, L.EPOCH, __import__("datetime").date(2100, 1, 1), source="tiingo", adjustment="split_dividend")
    start = bars.height - 1000
    window = bars[start - 40:]
    spec = BacktestSpec(symbol=SYMBOL, start=window["trade_date"][0], end=window["trade_date"][-1], fast=10, slow=40,
                        slippage_bps=2.0, source="tiingo", price_basis="split_dividend")
    r = run_backtest(window, spec)
    eq = r.equity.filter(pl.col("trade_date") >= bars["trade_date"][start])
    assert v["rule"]["total_return"] == pytest.approx(eq["equity"][-1] / 100000.0 - 1)
    assert bars.height == N_BARS and v["growth"]["dates"][0] == bars["trade_date"][start].isoformat()


# ---- helpers (hand-computed)

def test_downsample_keeps_first_and_last_and_is_bounded():
    assert L._downsample(10) == list(range(10))
    idx = L._downsample(5000)
    assert len(idx) <= 300 and idx[0] == 0 and idx[-1] == 4999 and idx == sorted(set(idx))


def test_growth_and_yearly_on_a_small_series():
    from datetime import date
    d = [date(2020, 6, 1), date(2020, 12, 31), date(2021, 6, 1), date(2021, 12, 31)]
    rule = pl.DataFrame({"trade_date": d, "equity": [1000.0, 1100.0, 1100.0, 1210.0]})
    hold = pl.DataFrame({"trade_date": d, "equity": [1000.0, 1200.0, 1260.0, 1440.0]})
    g = L._growth(rule, hold)
    assert g["rule"] == [100.0, 110.0, 110.0, 121.0] and g["buy_hold"] == [100.0, 120.0, 126.0, 144.0]
    y = L._yearly(rule, hold)
    assert [(r["year"], round(r["rule"], 6), round(r["buy_hold"], 6)) for r in y] == [(2020, 0.1, 0.2), (2021, 0.1, 0.2)]


# ---- structure

def test_only_study_py_has_sql_on_lab_study():
    root = Path(__file__).resolve().parents[2] / "src" / "market_data"
    offenders = [str(p.relative_to(root)) for p in root.rglob("*.py") if "research.lab_study" in p.read_text(encoding="utf-8")
                 and p.name != "study.py"]
    assert offenders == []
