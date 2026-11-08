"""Grid search with trial recording (task 04_02)."""

from datetime import date

import pytest

from market_data.backtest import BacktestSpec
from market_data.validation import create_study, grid_search, make_grid, record_trials, study_summary
from tests.test_backtest import make_bars, synthetic_trend

D = date


def base(bars, **kw):
    return BacktestSpec(symbol="X", start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=2, slow=3,
                        initial_cash=1000.0, **kw)


def test_make_grid_filters_pairs_and_rejects_bad_input():
    assert make_grid([1, 2], [2, 3]) == [(1, 2), (1, 3), (2, 3)]
    for f, s in (([], [3]), ([1], []), ([0], [3]), ([1, 1], [3]), ([5], [3]), ([1.5], [3])):
        with pytest.raises(ValueError):
            make_grid(f, s)
    with pytest.raises(ValueError):
        make_grid(range(1, 30), range(30, 60))  # 29*30 = 870 pairs > 400


def test_golden_3_pair_grid_hand_computed():
    # golden data (tests/test_backtest.py), zero cost, final equity by hand:
    # (1,2): buy open d3 11.5, sell open d5 10.5, buy open d8 9.5, mark 10 -> 1000*(10.5/11.5)*(10/9.5) = 961.098 (-3.890%)
    # (1,3): buy open d4 12.5, sell open d5 10.5, buy open d8 9.5, mark 10 -> 1000*(10.5/12.5)*(10/9.5) = 884.211 (-11.579%)
    # (2,3): buy open d4 12.5, sell open d6 8.5 -> 680 (-32%)
    bars = make_bars()
    out = grid_search(bars, base(bars), make_grid([1, 2], [2, 3]), metric="total_return")
    assert [(r["fast"], r["slow"]) for r in out["rows"]] == [(1, 2), (1, 3), (2, 3)]
    assert [r["total_return"] for r in out["rows"]] == pytest.approx([-0.0389016, -0.1157895, -0.32], abs=1e-6)
    assert out["best"]["fast"] == 1 and out["best"]["slow"] == 2 and out["trials"] == 3


def test_deterministic_and_bad_arguments_rejected():
    bars = synthetic_trend(300)
    g = make_grid([3, 5], [10, 20])
    assert grid_search(bars, base(bars), g)["rows"] == grid_search(bars, base(bars), g)["rows"]
    with pytest.raises(ValueError):
        grid_search(bars, base(bars), g, metric="bogus")
    with pytest.raises(ValueError):
        grid_search(bars, base(bars), [(5, 3)])
    with pytest.raises(ValueError):
        grid_search(bars, base(bars), [(3, 5), (3, 5)])
    with pytest.raises(ValueError):
        grid_search(bars, base(bars), [])


def test_every_pair_is_recorded_and_reruns_add_trials(conn):
    bars = synthetic_trend(300)
    g = make_grid([2, 3, 5], [10, 20, 30, 40])  # 12 pairs
    sid = create_study(conn, "t", "X")
    out = grid_search(bars, base(bars), g)
    win = (bars["trade_date"][0], bars["trade_date"][-1])
    assert record_trials(conn, sid, "train", out["rows"], win) == 12
    s = study_summary(conn, sid)
    assert s["trials_by_phase"] == {"train": 12, "test": 0, "holdout": 0} and s["trial_count"] == 12
    first_ids = [t["trial_id"] for t in s["trials"]]
    record_trials(conn, sid, "train", out["rows"], win)  # attempts count
    s2 = study_summary(conn, sid)
    assert s2["trial_count"] == 24 and [t["trial_id"] for t in s2["trials"]][:12] == first_ids
    assert s2["best_train_sharpe"] == max(r["sharpe"] for r in out["rows"] if r["sharpe"] is not None)


def test_unknown_study_and_phase_rejected(conn):
    with pytest.raises(LookupError):
        study_summary(conn, 424242)
    with pytest.raises(LookupError):
        record_trials(conn, 424242, "train", [], (D(2020, 1, 1), D(2020, 2, 1)))
    sid = create_study(conn, "t", "X")
    with pytest.raises(ValueError):
        record_trials(conn, sid, "oops", [], (D(2020, 1, 1), D(2020, 2, 1)))
