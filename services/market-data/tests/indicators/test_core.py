import random

import polars as pl
import pytest

from market_data.indicators import ema, rsi, sma
from market_data.market import indicators as old


def close(a, b):
    assert len(a) == len(b)
    for x, y in zip(a, b):
        assert (x is None) == (y is None), (a, b)
        assert x is None or abs(x - y) < 1e-9, (a, b)


def test_sma_hand_computed():
    close(sma(list(range(1, 11)), 5), [None] * 4 + [3, 4, 5, 6, 7, 8])


def test_ema_hand_computed():
    close(ema([1, 2, 3, 4, 5], 3), [None, None, 2, 3, 4])


def test_rsi_hand_computed_wilder():
    close(rsi([1, 2, 1], 2), [None, None, 50.0])
    close(rsi([1, 2, 3], 2), [None, None, 100.0])
    close(rsi([1, 2, 1, 3], 2), [None, None, 50.0, 100 - 100 / 6])
    close(rsi([5, 5, 5, 5], 2), [None, None, 50.0, 50.0])


@pytest.mark.parametrize("fn,warm", [(sma, 4), (ema, 4), (rsi, 5)])
def test_length_and_warmup(fn, warm):
    out = fn([float(i % 7) for i in range(30)], 5)
    assert len(out) == 30 and out[:warm] == [None] * warm and out[warm] is not None


def test_short_series_gives_only_none():
    assert sma([1.0, 2.0], 5) == [None, None] and ema([1.0], 3) == [None] and rsi([1.0, 2.0], 14) == [None, None]


def test_window_below_two_is_refused():
    for fn in (sma, ema, rsi):
        with pytest.raises(ValueError):
            fn([1.0, 2.0, 3.0], 1)


def test_rsi_stays_between_0_and_100():
    rng = random.Random(1)
    xs = [100.0]
    for _ in range(500):
        xs.append(xs[-1] * (1 + rng.uniform(-0.05, 0.05)))
    assert all(0 <= v <= 100 for v in rsi(xs, 14) if v is not None)


@pytest.mark.parametrize("fn", [sma, ema, rsi])
def test_truncation_causality(fn):
    """The value on day t is the same whether the series ends at t or continues."""
    rng = random.Random(7)
    xs = [100.0]
    for _ in range(300):
        xs.append(xs[-1] * (1 + rng.uniform(-0.03, 0.03)))
    full = fn(xs, 10)
    for k in (15, 40, 99, 200, 301):
        close(fn(xs[:k], 10), full[:k])


def test_a_centred_window_fails_the_same_test():
    """Negative: a window that looks ahead is caught by the truncation test."""
    def centred(xs, n):
        h = n // 2
        return [None if i < h or i + h >= len(xs) else sum(xs[i - h:i + h + 1]) / (2 * h + 1) for i in range(len(xs))]
    xs = [float(i * i % 17) for i in range(60)]
    full = centred(xs, 6)
    with pytest.raises(AssertionError):
        close(centred(xs[:30], 6), full[:30])


def test_sma_equals_and_ema_converges_to_the_polars_indicators_of_sprint_03():
    xs = [100 + (i * 37 % 11) - (i % 5) for i in range(60)]
    import datetime
    df = pl.DataFrame({"trade_date": [datetime.date(2020, 1, 1) + datetime.timedelta(days=i) for i in range(len(xs))], "close": [float(x) for x in xs]})
    close(sma([float(x) for x in xs], 10), old.sma(df, 10).to_list())
    # The Sprint 03 EMA starts from the first close; this one starts from the mean of the first n closes (documented).
    # The two differ at first and converge, because the difference shrinks by (1 - alpha) every day.
    a, b = ema([float(x) for x in xs], 10), old.ema(df, 10).to_list()
    assert abs(a[9] - b[9]) > 1e-6
    assert all(abs(x - y) < 0.01 for x, y in zip(a[-10:], b[-10:]))
