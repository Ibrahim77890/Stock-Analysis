"""Golden, cross-check and truncation (causality) tests for indicators (task 02_05)."""

import math
from datetime import date, timedelta

import polars as pl
import psycopg
import pytest

from market_data.core import config
from market_data.market import indicators as ind
from market_data.market.read import get_bars


def frame(closes):
    return pl.DataFrame({"trade_date": [date(2020, 1, 1) + timedelta(days=i) for i in range(len(closes))], "close": closes})


def test_golden_sma_and_returns():
    df = frame([10.0, 11.0, 12.0, 13.0])
    assert ind.sma(df, 3).to_list() == [None, None, 11.0, 12.0]          # (10+11+12)/3, (11+12+13)/3
    assert ind.simple_return(frame([100.0, 102.0])).to_list() == [None, pytest.approx(0.02)]
    assert ind.log_return(frame([100.0, 102.0]))[1] == pytest.approx(math.log(1.02))


def test_golden_ema():
    # alpha = 2/(3+1) = 0.5: ema1 = 10 (seed), ema2 = .5*11+.5*10 = 10.5, ema3 = .5*12+.5*10.5 = 11.25
    out = ind.ema(frame([10.0, 11.0, 12.0]), 3).to_list()
    assert out[:2] == [None, None] and out[2] == pytest.approx(11.25)


def test_golden_volatility():
    # closes 100,110,99 -> returns +10%, -10%; sample std of (0.1,-0.1) = sqrt(0.02); not annualised
    out = ind.rolling_volatility(frame([100.0, 110.0, 99.0]), 2, annualise=False).to_list()
    assert out[:2] == [None, None] and out[2] == pytest.approx(math.sqrt(0.02))


def test_unsorted_and_bad_window_rejected():
    with pytest.raises(ValueError):
        ind.sma(frame([1.0, 2.0, 3.0]).reverse(), 2)
    with pytest.raises(ValueError):
        ind.sma(frame([1.0, 2.0]), 0)
    with pytest.raises(ValueError):
        ind.compute(frame([1.0, 2.0]), "nope:3")


def test_compute_spec_parser():
    assert ind.compute(frame([10.0, 11.0, 12.0]), "sma:3").to_list()[2] == 11.0


@pytest.fixture(scope="module")
def aapl():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    df = get_bars(c, "AAPL", date(2016, 1, 1), date(2025, 12, 31), adjustment="split")
    c.close()
    if df.height < 300:
        pytest.skip("real AAPL data not loaded")
    return df


CASES = {"simple_return": ind.simple_return, "log_return": ind.log_return, "sma": lambda d: ind.sma(d, 20),
         "ema": lambda d: ind.ema(d, 20), "volatility": lambda d: ind.rolling_volatility(d, 20)}


@pytest.mark.parametrize("name", list(CASES))
def test_every_indicator_is_causal_on_real_data(aapl, name):
    assert ind.check_truncation(CASES[name], aapl, cut_points=100) == []


def test_leaky_centered_window_is_detected(aapl):
    leaky = lambda d: d.select(pl.col("close").rolling_mean(window_size=20, center=True)).to_series()  # noqa: E731
    assert ind.check_truncation(leaky, aapl, cut_points=100) != []


def test_sma_ema_match_polars_builtins(aapl):
    ref_sma = aapl.select(pl.col("close").rolling_mean(window_size=20)).to_series().to_list()
    ref_ema = aapl.select(pl.col("close").ewm_mean(span=20, adjust=False, min_samples=20)).to_series().to_list()
    for a, b in list(zip(ind.sma(aapl, 20).to_list(), ref_sma)) + list(zip(ind.ema(aapl, 20).to_list(), ref_ema)):
        assert (a is None and b is None) or a == pytest.approx(b)


def test_raw_prices_make_a_fake_split_return_but_adjusted_do_not():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(str(exc))
    raw = get_bars(c, "AAPL", date(2020, 8, 25), date(2020, 9, 4))
    adj = get_bars(c, "AAPL", date(2020, 8, 25), date(2020, 9, 4), adjustment="split")
    c.close()
    assert min(ind.simple_return(raw).drop_nulls()) < -0.7
    assert min(ind.simple_return(adj).drop_nulls()) > -0.15
