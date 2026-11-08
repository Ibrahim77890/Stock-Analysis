"""Universe scan and best-of-N control (task 04_06)."""

from dataclasses import replace
from datetime import date

import psycopg
import pytest

from market_data import config
from market_data.backtest import BacktestSpec
from market_data.scan import best_of_n_from_bars, load_universe, scan_bars, universe_scan, best_of_n_control
from tests.test_validation_split import zero_drift_walk

D = date
SPEC = BacktestSpec(symbol="X", start=D(2018, 1, 1), end=D(2030, 1, 1), fast=20, slow=50)


def universe(n: int, bars: int, seed0: int):
    return {f"S{i}": zero_drift_walk(bars, seed0 + i) for i in range(n)}


def test_same_seed_same_output_other_seed_differs():
    u = universe(5, 300, 1)
    a = best_of_n_from_bars(u, SPEC, replicates=10, seed=3)
    b = best_of_n_from_bars(u, SPEC, replicates=10, seed=3)
    c = best_of_n_from_bars(u, SPEC, replicates=10, seed=4)
    assert a == b and a["control_max_sharpe_quantiles"] != c["control_max_sharpe_quantiles"]


def test_best_sharpe_is_non_decreasing_when_symbols_are_added():
    u = universe(8, 300, 7)
    keys = list(u)
    bests = [scan_bars({k: u[k] for k in keys[:n]}, SPEC)["best_sharpe"] for n in range(1, 9)]
    assert bests == sorted(bests)


def test_no_edge_control_pre_registered():
    """Thresholds fixed before running: on 20 random-walk symbols (500 bars) with 25 replicates, the real best-of-N
    Sharpe has a percentile rank inside [0.025, 0.975] in at least 16 of 20 seeds. (Scaled down from 30 symbols
    to keep the suite fast; the expected in-range share is about 93%.)"""
    inside = 0
    for seed in range(20):
        out = best_of_n_from_bars(universe(20, 500, 1000 * seed), SPEC, replicates=25, seed=seed)
        inside += 0.025 <= out["percentile_rank"] <= 0.975
    assert inside >= 16, inside


def test_invalid_arguments():
    u = universe(3, 300, 1)
    with pytest.raises(ValueError):
        best_of_n_from_bars(u, SPEC, replicates=0)
    with pytest.raises(ValueError):
        best_of_n_from_bars({}, SPEC)


@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.instrument")
        if cur.fetchone()[0] < 50:
            pytest.skip("real universe not loaded")
    yield c
    c.close()


def real_spec(**kw):
    return BacktestSpec(symbol="UNIVERSE", start=D(2018, 1, 1), end=D(2025, 12, 31), fast=20, slow=50, **kw)


def test_real_scan_counts_reconcile_and_short_windows_are_skipped_not_crashed(real):
    out = universe_scan(real, real_spec(), min_bars=500)
    assert out["n"] + len(out["skipped"]) == 53 and out["n"] == 53 and out["caveat"]
    out2 = universe_scan(real, real_spec(), min_bars=1366)
    assert out2["n"] + len(out2["skipped"]) == 53 and out2["skipped"] and all("only" in s["reason"] for s in out2["skipped"])
    with pytest.raises(ValueError):
        universe_scan(real, replace(real_spec(), start=D(2025, 12, 1)), min_bars=500)  # nothing eligible
    with pytest.raises(ValueError):
        universe_scan(real, real_spec(), symbols=["AAPL", "NOPE"])


def test_real_best_of_n_is_reproducible(real):
    a = best_of_n_control(real, real_spec(), symbols=["AAPL", "SPY", "MSFT", "XLK"], replicates=8, seed=2)
    b = best_of_n_control(real, real_spec(), symbols=["AAPL", "SPY", "MSFT", "XLK"], replicates=8, seed=2)
    assert a == b and a["n_symbols"] == 4


def test_end_date_is_honoured_like_a_truncated_database(real, conn):
    from tests.test_replay_and_reads import _copy_upto
    cut = D(2022, 6, 30)
    full = universe_scan(real, replace(real_spec(), end=cut), symbols=["AAPL"], min_bars=100)
    _copy_upto(real, conn, "AAPL", cut)
    trunc = universe_scan(conn, real_spec(), symbols=["AAPL"], min_bars=100)
    assert full["rows"] == trunc["rows"] and full["rows"][0]["bars"] > 100
    assert load_universe(real, replace(real_spec(), end=cut), ["AAPL"], 100)[0]["AAPL"]["trade_date"].max() <= cut
