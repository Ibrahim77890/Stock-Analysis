"""Luck controls (task 03_07) and cost sweep (task 03_06)."""

from dataclasses import replace
from datetime import date

import polars as pl
import psycopg
import pytest

from market_data import config
from market_data.backtest import BacktestSpec, break_even, cost_sweep, run_backtest
from market_data.luck import block_bootstrap_path, make_paths, shuffle_test
from tests.test_backtest import synthetic_trend

D = date


def spec_for(bars, **kw):
    return BacktestSpec(symbol="X", start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=5, slow=20, **kw)


def ohlc_ok(df: pl.DataFrame) -> bool:
    return bool(((df["high"] >= df.select(pl.max_horizontal("open", "close")).to_series() - 1e-9).all()
                 and (df["low"] <= df.select(pl.min_horizontal("open", "close")).to_series() + 1e-9).all()
                 and (df.select(pl.min_horizontal("open", "high", "low", "close")).to_series() > 0).all()))


@pytest.mark.parametrize("method", ["block_bootstrap", "gbm"])
def test_paths_are_valid_same_length_and_start_at_real_close(method):
    bars = synthetic_trend(250)
    paths = list(make_paths(bars, method, 200, 20, seed=3))
    assert len(paths) == 200
    for p in paths:
        assert p.height == bars.height and p["close"][0] == bars["close"][0] and ohlc_ok(p)
        assert p["trade_date"].to_list() == bars["trade_date"].to_list()


def test_same_seed_same_output_different_seed_different_output():
    bars = synthetic_trend(250)
    s = spec_for(bars)
    a = shuffle_test(bars, s, n_paths=30, seed=5)
    b = shuffle_test(bars, s, n_paths=30, seed=5)
    c = shuffle_test(bars, s, n_paths=30, seed=6)
    assert a == b and a["paths"] != c["paths"]


def test_full_length_block_reproduces_the_real_path():
    import numpy as np
    bars = synthetic_trend(100)
    p = block_bootstrap_path(bars, bars.height - 1, np.random.default_rng(1))
    for col in ("open", "high", "low", "close"):
        assert p[col].to_list() == pytest.approx(bars[col].to_list(), rel=1e-12)


def test_invalid_arguments_raise():
    bars = synthetic_trend(100)
    s = spec_for(bars)
    with pytest.raises(ValueError):
        shuffle_test(bars, s, n_paths=0)
    with pytest.raises(ValueError):
        shuffle_test(bars, s, block_length=0)
    with pytest.raises(ValueError):
        shuffle_test(bars, s, block_length=bars.height)  # longer than the n-1 relatives
    with pytest.raises(ValueError):
        shuffle_test(bars, s, method="nope")


def test_no_edge_control_over_20_seeds_pre_registered_threshold():
    """Thresholds fixed before running: on random-walk 'real' data the real result's percentile rank among
    GBM controls lies inside [0.025, 0.975] in at least 16 of 20 seeds (expected about 19)."""
    import numpy as np
    base = synthetic_trend(400, seed=99)
    inside = 0
    for seed in range(20):
        real = next(make_paths(base, "gbm", 1, seed=1000 + seed))  # a random walk by construction
        out = shuffle_test(real, spec_for(real), method="gbm", n_paths=100, seed=seed)
        r = out["total_return"]["percentile_rank"]
        inside += 0.025 <= r <= 0.975
    assert inside >= 16, inside


# ---- cost sweep (03_06)

def test_zero_cost_row_equals_plain_run_and_returns_do_not_rise_with_cost():
    from market_data.metrics import summarise
    bars = synthetic_trend(400)
    s = spec_for(bars)
    rows = cost_sweep(bars, s, [0, 1, 5, 20, 50])
    plain = run_backtest(bars, s)
    assert rows[0]["total_return"] == summarise(plain.equity, plain.trades)["total_return"]
    rets = [r["total_return"] for r in rows]
    assert rets == sorted(rets, reverse=True)


def test_break_even_hand_computed_interpolation():
    rows = [{"cost_bps": 0, "total_return": 0.10, "benchmark_total_return": 0.0},
            {"cost_bps": 10, "total_return": 0.04, "benchmark_total_return": 0.0},
            {"cost_bps": 20, "total_return": -0.02, "benchmark_total_return": 0.0}]
    assert break_even(rows) == pytest.approx(10 + 10 * 0.04 / 0.06)  # crosses zero between 10 and 20 bps
    assert break_even(rows[:2]) is None  # still above zero at the last grid point
    assert break_even([{"cost_bps": 0, "total_return": -0.1, "benchmark_total_return": 0.0}]) == 0.0
    with pytest.raises(ValueError):
        break_even(rows, "bogus")


@pytest.mark.parametrize("grid", [[], [-1, 0], [5, 1], [1, 1, 2]])
def test_bad_grids_raise(grid):
    bars = synthetic_trend(100)
    with pytest.raises(ValueError):
        cost_sweep(bars, spec_for(bars), grid)


# ---- real data (read-only)

@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) "
                    "WHERE i.symbol IN ('AAPL','SPY')")
        if cur.fetchone()[0] < 1000:
            pytest.skip("real AAPL/SPY data not loaded")
    yield c
    c.close()


@pytest.mark.parametrize("symbol,fast,slow", [("AAPL", 20, 50), ("SPY", 20, 50), ("SPY", 2, 3)])
def test_real_cost_sweep_is_monotone_and_reports_trades(real, symbol, fast, slow):
    from market_data.read import get_bars
    start = D(2020, 7, 27) if symbol == "AAPL" else D(2018, 11, 1)
    bars = get_bars(real, symbol, start, D(2025, 12, 31), adjustment="split")
    s = BacktestSpec(symbol=symbol, start=start, end=D(2025, 12, 31), fast=fast, slow=slow)
    rows = cost_sweep(bars, s)
    rets = [r["total_return"] for r in rows]
    assert rets == sorted(rets, reverse=True) and rows[0]["trades"] > 0
