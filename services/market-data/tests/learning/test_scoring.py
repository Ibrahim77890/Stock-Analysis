import math
import random

import numpy as np
import pytest

from market_data.learning import scoring as sc


def test_golden_four_forecasts():
    f, y = [0.9, 0.8, 0.3, 0.6], [1, 0, 0, 1]
    assert sc.brier(f, y) == pytest.approx(0.225)
    assert sc.skill_score(sc.brier(f, y)) == pytest.approx(0.10)
    expected = -(math.log(0.9) + math.log(0.2) + math.log(0.7) + math.log(0.6)) / 4
    assert sc.log_loss(f, y) == pytest.approx(expected)


def test_coin_flip_is_exactly_a_quarter_and_decomposition_identity():
    y = [1, 0, 0, 1, 1, 0, 1]
    f = [0.5] * 7
    assert sc.brier(f, y) == 0.25
    d = sc.murphy_decomposition(f, y)
    ybar = sum(y) / len(y)
    assert d["rel"] == pytest.approx((0.5 - ybar) ** 2) and d["res"] == pytest.approx(0.0) and d["unc"] == pytest.approx(ybar * (1 - ybar))
    assert d["exact"] is True
    assert d["rel"] - d["res"] + d["unc"] == pytest.approx(d["brier"], abs=1e-12)


def test_murphy_exact_flag_false_when_forecasts_vary_inside_a_bin():
    d = sc.murphy_decomposition([0.61, 0.69, 0.62], [1, 0, 1])
    assert d["exact"] is False


def test_wilson_intervals():
    lo, hi = sc.wilson(5, 10)
    assert (lo, hi) == (pytest.approx(0.237, abs=0.001), pytest.approx(0.763, abs=0.001))
    lo0, hi0 = sc.wilson(0, 5)
    assert lo0 == 0.0 and hi0 == pytest.approx(0.434, abs=0.001)
    for s, n in ((0, 7), (7, 7), (1, 1), (0, 1)):
        a, b = sc.wilson(s, n)
        assert 0.0 <= a <= b <= 1.0
    with pytest.raises(ValueError):
        sc.wilson(0, 0)


def test_bin_edges():
    bins = sc.calibration_bins([0.1, 0.99, 0.0999 + 0.0001 * 0, 0.3, 0.2], [1, 1, 0, 0, 1])
    n = {round(b["bin_low"], 1): b["n"] for b in bins}
    assert n[0.0] == 1 and n[0.1] == 1 and n[0.2] == 1 and n[0.3] == 1 and n[0.9] == 1   # 0.0999 -> 1st bin, 0.1 -> 2nd, 0.2 -> 3rd, 0.3 -> 4th
    first = sc.calibration_bins([0.0999], [1])
    assert first[0]["n"] == 1
    assert sum(b["n"] for b in bins) == 5                                    # reconciliation: bin counts sum to n


def test_empty_bins_have_no_statistics():
    bins = sc.calibration_bins([0.55], [1])
    empty = [b for b in bins if b["n"] == 0]
    assert len(empty) == 9 and all(b["observed"] is None and b["wilson_low"] is None for b in empty)


@pytest.mark.parametrize("f,y", [([0.0], [1]), ([1.0], [1]), ([0.5], [2]), ([0.5, 0.5], [1]), ([float("nan")], [1]), ([0.005], [0])])
def test_invalid_input_raises(f, y):
    with pytest.raises(ValueError):
        sc.validate(f, y)


def test_empty_input_is_allowed():
    s = sc.summarise([], [])
    assert s["n"] == 0 and s["enough"] is False and s["brier"] is None and s["luck"]["luck_probability"] is None


def test_permutation_is_deterministic_never_zero_and_seed_matters():
    rng = random.Random(3)
    f = [rng.uniform(0.05, 0.95) for _ in range(40)]
    y = [rng.randint(0, 1) for _ in range(40)]
    a = sc.permutation_luck(f, y, n_perm=2000, seed=1)
    b = sc.permutation_luck(f, y, n_perm=2000, seed=1)
    c = sc.permutation_luck(f, y, n_perm=2000, seed=2)
    assert a == b and a["shuffled_quantiles"] != c["shuffled_quantiles"]
    assert a["luck_probability"] > 0


def test_perfect_forecaster_is_very_unlikely_luck():
    y = [1, 0] * 30
    f = [0.99 if v else 0.01 for v in y]
    r = sc.permutation_luck(f, y, n_perm=5000, seed=1)
    assert r["luck_probability"] < 0.001 and r["count"] == 0


def test_coin_flipper_luck_probability_averages_near_one_half():
    ps = []
    for seed in range(200):
        rng = random.Random(seed)
        f = [rng.uniform(0.05, 0.95) for _ in range(40)]
        y = [rng.randint(0, 1) for _ in range(40)]
        ps.append(sc.permutation_luck(f, y, n_perm=1000, seed=seed)["luck_probability"])
    assert abs(np.mean(ps) - 0.5) < 0.05


def test_permutation_shuffles_within_each_horizon():
    # horizon 1 outcomes are all 1, horizon 10 outcomes all 0: a within-group shuffle cannot change the score
    f = [0.7, 0.6, 0.4, 0.3]
    y = [1, 1, 0, 0]
    r = sc.permutation_luck(f, y, horizons=[1, 1, 10, 10], n_perm=500, seed=1)
    assert r["count"] == 500 and r["luck_probability"] == 1.0


def test_warnings_thresholds():
    rng = random.Random(1)

    def run(n, horizons=None, f=None):
        ff = f or [rng.uniform(0.05, 0.95) for _ in range(n)]
        return sc.summarise(ff, [rng.randint(0, 1) for _ in ff], horizons, n_perm=100)

    assert any("too few" in w for w in run(29)["warnings"])
    assert not any("too few" in w for w in run(30)["warnings"])
    assert run(30)["enough"] and not run(29)["enough"] and run(29)["luck"]["not_reported"] is True
    assert any("overlapping" in w for w in run(30, [1] * 29 + [5])["warnings"])
    assert not any("overlapping" in w for w in run(30, [1] * 30)["warnings"])
    assert any("sparse" in w for w in run(0, f=[0.55, 0.56, 0.57, 0.58])["warnings"])   # a bin with 4 points


def test_honest_forecaster_does_not_score_worse_than_an_exaggerator():
    rng = np.random.default_rng(11)
    p_true = rng.uniform(0.2, 0.8, 2000)
    y = (rng.random(2000) < p_true).astype(int)
    exaggerated = np.clip(0.5 + 2.0 * (p_true - 0.5), 0.01, 0.99)
    assert sc.brier(p_true, y) <= sc.brier(exaggerated, y)


def test_reference_check_against_scikit_learn():
    skl = pytest.importorskip("sklearn.metrics")
    rng = np.random.default_rng(5)
    f = rng.uniform(0.01, 0.99, 300)
    y = rng.integers(0, 2, 300)
    assert sc.brier(f, y) == pytest.approx(skl.brier_score_loss(y, f), abs=1e-12)


def test_baselines_are_labelled_in_sample():
    b = sc.baselines([1, 1, 0, 1])
    assert b["coin_flip"] == 0.25 and b["base_rate"] == pytest.approx(0.75 * 0.25) and "in-sample" in b["base_rate_note"]
