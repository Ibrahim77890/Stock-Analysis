import math
import random
import statistics
from datetime import date, timedelta

import polars as pl
import psycopg
import pytest

from market_data.core import config
from market_data.backtesting.backtest import BacktestSpec, backtest_from_db, full_run
from market_data.ingestion.macro import VIX_HIGH, VIX_LOW, daily_risk_free, risk_free_series, vix_bucket, vix_labels
from market_data.backtesting.metrics import excess_sharpe, sharpe
from market_data.market.read import get_macro
from market_data.validation.regimes import regime_breakdown, regime_labels

D = date
BASE = D(2022, 1, 3)


def equity_from(returns, start=100.0):
    out = [start]
    for r in returns:
        out.append(out[-1] * (1 + r))
    return out


def obs(rows):
    return pl.DataFrame({"obs_date": [r[0] for r in rows], "value": [r[1] for r in rows]},
                        schema={"obs_date": pl.Date, "value": pl.Float64})


# ---- excess Sharpe

def test_zero_rf_equals_plain_sharpe_exactly():
    eq = equity_from([0.01, -0.005, 0.002, 0.007, -0.001, 0.003])
    assert excess_sharpe(eq, [0.0] * len(eq)) == sharpe(eq)


def test_golden_five_returns_constant_rf():
    rets = [0.01, -0.005, 0.002, 0.007, -0.001]
    eq = equity_from(rets)
    rf = 0.0002
    ex = [(eq[i + 1] / eq[i] - 1) - rf for i in range(5)]
    expected = statistics.mean(ex) / statistics.stdev(ex) * math.sqrt(252)
    assert excess_sharpe(eq, [rf] * 6) == pytest.approx(expected, rel=1e-12)
    assert excess_sharpe(eq, [rf] * 6) < sharpe(eq)


def test_excess_sharpe_undefined_cases_and_length_check():
    assert excess_sharpe([100.0, 101.0], [0.0, 0.0]) is None          # one return
    flat = [100.0, 100.0, 100.0, 100.0]
    assert excess_sharpe(flat, [0.0] * 4) is None                     # zero std
    with pytest.raises(ValueError):
        excess_sharpe(equity_from([0.01, 0.02]), [0.0, 0.0])


# ---- risk-free series: previous day's yield, percent -> decimal, /252

def test_rf_uses_previous_observation_and_converts_units():
    o = obs([(D(2022, 1, 3), 4.80), (D(2022, 1, 4), 5.04), (D(2022, 1, 5), None), (D(2022, 1, 6), 5.0)])
    rf = risk_free_series(o, [D(2022, 1, 4), D(2022, 1, 5), D(2022, 1, 6), D(2022, 1, 7)])
    assert rf == pytest.approx([4.80 / 100 / 252, 5.04 / 100 / 252, 5.04 / 100 / 252, 5.0 / 100 / 252])
    assert 5.04 / 100 / 252 == pytest.approx(0.0002)


def test_changing_todays_yield_changes_tomorrows_rf_only():
    base = [(D(2022, 1, 3), 4.0), (D(2022, 1, 4), 4.5), (D(2022, 1, 5), 4.7)]
    changed = [(D(2022, 1, 3), 4.0), (D(2022, 1, 4), 9.9), (D(2022, 1, 5), 4.7)]
    d = [D(2022, 1, 4), D(2022, 1, 5)]
    a, b = risk_free_series(obs(base), d), risk_free_series(obs(changed), d)
    assert a[0] == b[0]          # today's rf (01-04) does not use today's value
    assert a[1] != b[1]          # tomorrow's rf (01-05) does


def test_rf_before_first_observation_raises():
    with pytest.raises(LookupError):
        risk_free_series(obs([(D(2022, 1, 3), 4.0)]), [D(2022, 1, 3)])


# ---- VIX buckets

def test_bucket_edges_are_fixed_in_advance():
    assert (VIX_LOW, VIX_HIGH) == (15.0, 25.0)
    assert [vix_bucket(v) for v in (14.99, 15.0, 24.99, 25.0, None)] == ["low", "medium", "medium", "high", "unknown"]


def test_labels_use_previous_day_and_unknown_before_start():
    o = obs([(D(2022, 1, 3), 12.0), (D(2022, 1, 4), 30.0), (D(2022, 1, 5), None)])
    assert vix_labels(o, [D(2022, 1, 3), D(2022, 1, 4), D(2022, 1, 5), D(2022, 1, 6)]) == ["unknown", "low", "high", "high"]


def test_fuzz_label_of_a_day_never_depends_on_that_days_or_later_vix():
    rng = random.Random(21)
    start = D(2021, 1, 4)
    base = [(start + timedelta(days=i), rng.uniform(9, 45)) for i in range(400)]
    dates = [start + timedelta(days=i) for i in range(1, 400)]
    ref = dict(zip(dates, vix_labels(obs(base), dates)))
    for _ in range(50):
        d = rng.choice(dates)
        altered = [(dd, (rng.uniform(1, 80) if dd >= d else v)) for dd, v in base]
        assert vix_labels(obs(altered), [d])[0] == ref[d], d
    # and the label does change when an EARLIER value changes bucket (so the test is not vacuous)
    d = dates[200]
    prev = max(dd for dd, _ in base if dd < d)
    flipped = [(dd, (99.0 if dd == prev else v)) for dd, v in base]
    assert vix_labels(obs(flipped), [d])[0] == "high"


# ---- database

@pytest.fixture
def macro_db(conn):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO market.ingestion_job (kind,source,file_name,file_sha256,status) VALUES "
                    "('macro','fred','x','x','succeeded') RETURNING ingestion_job_id")
        jid = cur.fetchone()[0]
        rows = [("DGS3MO", D(2022, 1, 3), 0.05), ("DGS3MO", D(2022, 1, 4), None), ("DGS3MO", D(2022, 1, 5), 0.20),
                ("VIXCLS", D(2022, 1, 3), 17.0), ("VIXCLS", D(2022, 1, 4), 26.0)]
        cur.executemany("INSERT INTO market.macro_observation (series_id,obs_date,value,source,ingestion_job_id) "
                        "VALUES (%s,%s,%s,'fred',%s)", [(*r, jid) for r in rows])
    conn.commit()
    return conn


def test_daily_risk_free_from_database_skips_null_and_raises_before_start(macro_db):
    rf = daily_risk_free(macro_db, [D(2022, 1, 5), D(2022, 1, 6)])
    assert rf == pytest.approx([0.05 / 100 / 252, 0.20 / 100 / 252])      # 01-04 is NULL: 01-05 uses 01-03's value
    with pytest.raises(LookupError):
        daily_risk_free(macro_db, [D(2022, 1, 3)])


def test_database_vix_label_unchanged_by_same_day_or_later_edit(macro_db):
    d = [D(2022, 1, 5)]
    before = vix_labels(get_macro(macro_db, "VIXCLS"), d)
    with macro_db.cursor() as cur:
        cur.execute("INSERT INTO market.macro_observation (series_id,obs_date,value,source,ingestion_job_id) "
                    "SELECT 'VIXCLS', %s, 5.0, 'fred', ingestion_job_id FROM market.ingestion_job LIMIT 1", (D(2022, 1, 5),))
        cur.execute("UPDATE market.macro_observation SET value = 99 WHERE series_id='VIXCLS' AND obs_date >= %s", (D(2022, 1, 5),))
    macro_db.commit()
    assert vix_labels(get_macro(macro_db, "VIXCLS"), d) == before == ["high"]


# ---- engine integration

def test_full_run_default_unchanged_and_rf_adds_key():
    dates = [BASE + timedelta(days=i) for i in range(80)]
    closes = [100 + 10 * math.sin(i / 6) + i * 0.1 for i in range(80)]
    bars = pl.DataFrame({"trade_date": dates, "open": closes, "high": [c + 1 for c in closes],
                         "low": [c - 1 for c in closes], "close": closes, "volume": [100] * 80})
    s = BacktestSpec(symbol="X", start=dates[0], end=dates[-1], fast=3, slow=10)
    plain = full_run(bars, s)
    with_rf = full_run(bars, s, rf=[0.0001] * 80)
    assert "sharpe_excess" not in plain["metrics"] and "sharpe_excess" in with_rf["metrics"]
    assert {k: v for k, v in with_rf["metrics"].items() if k != "sharpe_excess"} == plain["metrics"]
    assert with_rf["benchmark_metrics"]["sharpe_excess"] is not None
    zero = full_run(bars, s, rf=[0.0] * 80)
    assert zero["metrics"]["sharpe_excess"] == zero["metrics"]["sharpe"]


# ---- real data

@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        try:
            cur.execute("SELECT count(*) FROM market.macro_observation WHERE series_id = 'VIXCLS'")
        except psycopg.Error:
            c.rollback()
            pytest.skip("macro table missing")
        if cur.fetchone()[0] < 1000:
            pytest.skip("real VIXCLS not loaded")
    yield c
    c.close()


@pytest.mark.parametrize("symbol,source", [("SPY", "alpaca"), ("AAPL", "alpaca"), ("SPY", "tiingo"), ("AAPL", "tiingo")])
def test_vix_regime_growth_factors_multiply_to_total_growth(real, symbol, source):
    start = D(2020, 7, 27) if source == "alpaca" else D(2005, 1, 3)
    s = BacktestSpec(symbol=symbol, start=start, end=D(2025, 12, 31), fast=20, slow=50, source=source)
    bars, res = backtest_from_db(real, s)
    vix = get_macro(real, "VIXCLS")
    out = regime_breakdown(res, bars, "vix", vix=vix)
    prod = math.prod(g["growth_factor"] for g in out["groups"])
    total = res.equity["equity"][-1] / s.initial_cash
    assert prod == pytest.approx(total, rel=1e-9)
    assert sum(g["days"] for g in out["groups"]) == bars.height
    assert {g["label"] for g in out["groups"]} <= {"unknown", "low", "medium", "high"}
    assert "not endorsed or certified" in out["note"]


def test_regime_vix_requires_the_series():
    bars = pl.DataFrame({"trade_date": [BASE + timedelta(days=i) for i in range(30)], "open": [1.0] * 30,
                         "high": [1.0] * 30, "low": [1.0] * 30, "close": [1.0] * 30, "volume": [1] * 30})
    with pytest.raises(ValueError):
        regime_labels(bars, "vix")
