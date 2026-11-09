"""Run storage and reproducibility hashes (tasks 03_01, 03_05). DB tests need TEST_DATABASE_URL."""

from dataclasses import replace
from datetime import date

import polars as pl
import psycopg
import pytest

from market_data.core import config
from market_data.backtesting.backtest import ENGINE_VERSION, BacktestSpec, backtest_from_db, full_run
from market_data.backtesting.research import canonical_json, config_hash, dataset_fingerprint, get_equity, get_run, get_trades, list_runs, reproduce_run, result_hash, save_run
from tests.market.test_replay_and_reads import _copy_upto

D = date
SPEC = BacktestSpec(symbol="AAPL", start=D(2020, 7, 27), end=D(2021, 12, 31), fast=5, slow=20,
                    commission_bps=1, slippage_bps=2)
FP = "a" * 64


def test_canonical_json_ignores_key_order_and_number_spelling():
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})
    assert config_hash(replace(SPEC, slippage_bps=5), FP) == config_hash(replace(SPEC, slippage_bps=5.0), FP)


@pytest.mark.parametrize("change", [
    dict(symbol="SPY"), dict(fast=6), dict(slow=21), dict(fill_model="same_close"), dict(commission_bps=1.5),
    dict(slippage_bps=2.5), dict(initial_cash=50_000.0), dict(start=D(2020, 7, 28)), dict(end=D(2021, 12, 30))])
def test_changing_any_field_changes_the_config_hash(change):
    assert config_hash(replace(SPEC, **change), FP) != config_hash(SPEC, FP)


def test_engine_version_and_dataset_change_the_hash():
    assert config_hash(SPEC, FP, "2") != config_hash(SPEC, FP, ENGINE_VERSION)
    assert config_hash(SPEC, "b" * 64) != config_hash(SPEC, FP)


@pytest.fixture
def stored(real_db, conn):
    _copy_upto(real_db, conn, "AAPL", SPEC.end)
    with conn.cursor() as cur:
        cur.execute("TRUNCATE research.backtest_run RESTART IDENTITY CASCADE")
    conn.commit()
    return conn


@pytest.fixture(scope="module")
def real_db():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) "
                    "WHERE i.symbol = 'AAPL'")
        if cur.fetchone()[0] < 500:
            pytest.skip("real AAPL data not loaded")
    yield c
    c.close()


def test_fingerprint_changes_when_one_bar_changes():
    bars = pl.DataFrame({"trade_date": [D(2024, 1, 1), D(2024, 1, 2)], "open": [1.0, 2.0], "high": [2.0, 3.0],
                         "low": [0.5, 1.5], "close": [1.5, 2.5], "volume": [10, 20]})
    other = bars.with_columns(pl.when(pl.col("trade_date") == D(2024, 1, 2)).then(21).otherwise(pl.col("volume"))
                              .alias("volume"))
    assert dataset_fingerprint(bars) != dataset_fingerprint(other)
    assert dataset_fingerprint(bars) == dataset_fingerprint(bars.clone())


def test_save_twice_is_idempotent_and_rows_reconcile(stored):
    bars, _ = backtest_from_db(stored, SPEC)
    a = save_run(stored, SPEC, bars)
    b = save_run(stored, SPEC, bars)
    assert a["created"] and not b["created"] and a["run_id"] == b["run_id"] and a["result_hash"] == b["result_hash"]
    with stored.cursor() as cur:
        cur.execute("SELECT count(*) FROM research.backtest_run")
        assert cur.fetchone()[0] == 1
    trades, equity = get_trades(stored, a["run_id"]), get_equity(stored, a["run_id"])
    assert len(equity) == bars.height
    assert SPEC.initial_cash + sum(t["pnl"] for t in trades) == pytest.approx(equity[-1]["equity"], abs=1e-3)
    assert get_run(stored, a["run_id"])["config_hash"] == a["config_hash"]
    assert [r["run_id"] for r in list_runs(stored)] == [a["run_id"]]
    with pytest.raises(LookupError):
        get_run(stored, 999)


def test_reproduce_returns_reproduced(stored):
    bars, _ = backtest_from_db(stored, SPEC)
    rid = save_run(stored, SPEC, bars)["run_id"]
    out = reproduce_run(stored, rid)
    assert out["status"] == "reproduced" and out["current_result_hash"] == out["stored_result_hash"]


def test_reproduce_detects_changed_data(stored):
    bars, _ = backtest_from_db(stored, SPEC)
    rid = save_run(stored, SPEC, bars)["run_id"]
    with stored.cursor() as cur:
        cur.execute("UPDATE market.bar_daily SET volume = volume + 1 WHERE trade_date = %s", (D(2021, 3, 1),))
    stored.commit()
    out = reproduce_run(stored, rid)
    assert out["status"] == "data_changed" and out["stored_fingerprint"] != out["current_fingerprint"]


def test_reproduce_detects_an_edited_result_hash(stored):
    bars, _ = backtest_from_db(stored, SPEC)
    rid = save_run(stored, SPEC, bars)["run_id"]
    with stored.cursor() as cur:
        cur.execute("UPDATE research.backtest_run SET result_hash = %s WHERE run_id = %s", ("0" * 64, rid))
    stored.commit()
    assert reproduce_run(stored, rid)["status"] == "engine_mismatch"


def test_database_rejects_duplicate_hash_and_orphan_trade(stored):
    bars, _ = backtest_from_db(stored, SPEC)
    rid = save_run(stored, SPEC, bars)["run_id"]
    run = get_run(stored, rid)
    with pytest.raises(psycopg.errors.UniqueViolation):
        with stored.cursor() as cur:
            cur.execute("INSERT INTO research.backtest_run (config_hash, result_hash, engine_version, spec, "
                        "dataset_fingerprint, symbol, realisable, metrics) VALUES (%s,%s,'1','{}',%s,'X',true,'{}')",
                        (run["config_hash"], "b" * 64, "c" * 64))
    stored.rollback()
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        with stored.cursor() as cur:
            cur.execute("INSERT INTO research.backtest_trade VALUES (9999,1,'2024-01-01','2024-01-02',1,1,1,0,0,true)")
    stored.rollback()


def test_result_hash_is_stable_and_sensitive():
    from tests.backtesting.test_backtest import make_bars, spec
    r = full_run(make_bars(), spec())["result"]
    assert result_hash(r.equity, r.trades) == result_hash(r.equity, r.trades)
    r2 = full_run(make_bars(), spec(slippage_bps=1))["result"]
    assert result_hash(r.equity, r.trades) != result_hash(r2.equity, r2.trades)
