"""Probabilistic / deflated Sharpe and the overfitting meter (task 04_05)."""

import math
from datetime import date

import numpy as np
import pytest

from market_data.sharpe_stats import (
    EULER_GAMMA, _psr_from_moments, deflated_sharpe, expected_max_sharpe, overfitting_meter, probabilistic_sharpe,
    sharpe_moments,
)
from market_data.backtest import BacktestSpec
from market_data.validation import create_study, grid_search, make_grid, record_trials
from tests.test_backtest import synthetic_trend


def phi(x: float) -> float:  # independent normal CDF via erf
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def phi_inv(p: float) -> float:  # independent inverse by bisection
    lo, hi = -10.0, 10.0
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if phi(mid) < p else (lo, mid)
    return (lo + hi) / 2


def test_golden_psr_normal_moments():
    sr = 1 / math.sqrt(252)
    # T=1000: numerator 0.0630*sqrt(999)=1.991; denominator sqrt(1+0.5*sr^2)=1.001 -> z=1.989, Phi = 0.9767
    assert _psr_from_moments(sr, 1000, 0.0, 3.0, 0.0)[0] == pytest.approx(0.977, abs=0.002)
    # T=250: z = 0.0630*sqrt(249)/1.001 = 0.993 -> 0.840
    assert _psr_from_moments(sr, 250, 0.0, 3.0, 0.0)[0] == pytest.approx(0.840, abs=0.002)


def test_psr_matches_independent_formula_on_real_looking_returns():
    r = np.random.default_rng(1).standard_t(5, 800) * 0.01 + 0.0006
    m = sharpe_moments(r)
    d = r - r.mean()
    skew, kurt = (d ** 3).mean() / (d ** 2).mean() ** 1.5, (d ** 4).mean() / (d ** 2).mean() ** 2
    sr = r.mean() / r.std(ddof=1)
    expected = phi(sr * math.sqrt(799) / math.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr ** 2))
    assert probabilistic_sharpe(r)["psr"] == pytest.approx(expected, abs=1e-12) and m["T"] == 800


def test_expected_max_sharpe_values():
    assert expected_max_sharpe(1, 1.0) == 0.0
    n = 100
    ref = (1 - EULER_GAMMA) * phi_inv(1 - 1 / n) + EULER_GAMMA * phi_inv(1 - 1 / (n * math.e))
    assert expected_max_sharpe(n, 1.0) == pytest.approx(ref, abs=1e-9)
    assert expected_max_sharpe(100, 4.0) == pytest.approx(2 * ref, abs=1e-9)


def test_properties_psr_t_dsr_n_and_benchmark():
    sr = 0.05
    assert _psr_from_moments(sr, 500, 0, 3, 0)[0] > _psr_from_moments(sr, 100, 0, 3, 0)[0]
    assert _psr_from_moments(sr, 500, 0, 3, 0.02)[0] < _psr_from_moments(sr, 500, 0, 3, 0)[0]
    rng = np.random.default_rng(4)
    r = rng.normal(0.001, 0.01, 500)
    dsr = []
    for n in (2, 5, 20, 100, 500):
        trials = list(np.random.default_rng(n).normal(0, 0.045, n))  # per-period Sharpe estimates, no skill
        dsr.append(deflated_sharpe(r, trials)["dsr"])
    assert dsr == sorted(dsr, reverse=True)  # more trials -> lower DSR at fixed data (roughly fixed variance)


def test_negative_and_degenerate_inputs():
    assert probabilistic_sharpe(np.random.default_rng(2).normal(0, 0.01, 29))["psr"] is None
    assert "fewer" in probabilistic_sharpe(np.random.default_rng(2).normal(0, 0.01, 29))["reason"]
    out = probabilistic_sharpe([0.001] * 100)
    assert out["psr"] is None and "zero variance" in out["reason"]
    with pytest.raises(ValueError):
        expected_max_sharpe(0, 1.0)
    with pytest.raises(ValueError):
        deflated_sharpe([0.01, -0.01] * 20, [])
    with pytest.raises(ValueError):
        sharpe_moments([0.01])


def test_monte_carlo_deflation_pre_registered():
    """Thresholds fixed before running: over 200 no-skill studies of 50 strategies (T=500 iid returns), the share
    whose best strategy has DSR > 0.95 is at most 10%, while the share with PSR(0) > 0.95 is at least 50%."""
    rng = np.random.default_rng(2024)
    dsr_hits = psr_hits = 0
    for _ in range(200):
        R = rng.normal(0.0, 0.01, (50, 500))
        sharpes = R.mean(axis=1) / R.std(axis=1, ddof=1)
        best = int(np.argmax(sharpes))
        psr_hits += probabilistic_sharpe(R[best])["psr"] > 0.95
        dsr_hits += deflated_sharpe(R[best], sharpes)["dsr"] > 0.95
    assert dsr_hits / 200 <= 0.10, dsr_hits
    assert psr_hits / 200 >= 0.50, psr_hits
    # reproducible
    rng2 = np.random.default_rng(2024)
    assert np.array_equal(rng2.normal(0.0, 0.01, (50, 500)), np.random.default_rng(2024).normal(0.0, 0.01, (50, 500)))


def test_overfitting_meter_on_a_recorded_study(real_conn_pair):
    conn, bars = real_conn_pair
    spec = BacktestSpec(symbol="AAPL", start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=2, slow=3)
    sid = create_study(conn, "m", "AAPL")
    g = make_grid([3, 5, 8], [20, 30, 40])
    out = grid_search(bars, spec, g)
    record_trials(conn, sid, "train", out["rows"], (bars["trade_date"][0], bars["trade_date"][-1]))
    m = overfitting_meter(conn, sid)
    assert m["trials"] == len(g) and m["best_sharpe_annualised"] == pytest.approx(out["best"]["sharpe"])
    assert m["expected_max_sharpe_per_period"] > 0 and 0 <= m["dsr"] <= 1
    with pytest.raises(ValueError):
        overfitting_meter(conn, create_study(conn, "empty", "AAPL"))


@pytest.fixture
def real_conn_pair(conn):
    """The throwaway database holding a copy of real AAPL (skipped when the real data are absent)."""
    import psycopg
    from market_data import config
    from market_data.read import get_bars
    from tests.test_replay_and_reads import _copy_upto
    try:
        real = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    _copy_upto(real, conn, "AAPL", date(2023, 12, 31))
    real.close()
    return conn, get_bars(conn, "AAPL", date(2020, 7, 27), date(2023, 12, 31), adjustment="split")
