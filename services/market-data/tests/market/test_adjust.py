"""Golden, real-data and causality tests for as-of adjustment (task 02_02)."""

import random
from datetime import date, timedelta

import polars as pl
import psycopg
import pytest

from market_data.core import config
from market_data.market.adjust import Adjustment, adjust_bars, dividend_factors, split_factors
from market_data.market.read import get_bars

D = date


def bars(rows):
    return pl.DataFrame(rows, schema={"trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64, "low": pl.Float64,
                                      "close": pl.Float64, "volume": pl.Int64}, orient="row")


def actions(rows):
    return pl.DataFrame(rows, schema={"action_type": pl.String, "ex_date": pl.Date, "split_from": pl.Float64,
                                      "split_to": pl.Float64, "cash_amount": pl.Float64}, orient="row")


# Golden case 1. Closes 400 (day 1), 100 (day 2); 4-for-1 split with ex-date on day 2.
#   as of day 1: split not visible -> 400 (the day-2 bar is after the cursor and dropped).
#   as of day 2: factor for day 1 = 1/4 -> 400 * 0.25 = 100; day 2 keeps factor 1 -> 100, 100.
GOLD = bars([(D(2020, 1, 1), 400, 400, 400, 400, 1000), (D(2020, 1, 2), 100, 100, 100, 100, 4000)])
SPLIT4 = actions([("split", D(2020, 1, 2), 1.0, 4.0, None)])


def test_golden_as_of_day_1_has_no_split():
    out = adjust_bars(GOLD, SPLIT4, D(2020, 1, 1), "split")
    assert out["close"].to_list() == [400.0] and out["factor"].to_list() == [1.0]


def test_golden_as_of_day_2_applies_split_before_ex_date():
    out = adjust_bars(GOLD, SPLIT4, D(2020, 1, 2), "split")
    assert out["close"].to_list() == [100.0, 100.0]
    assert out["factor"].to_list() == [0.25, 1.0]
    assert out["volume"].to_list() == [4000, 4000]  # 1000 / 0.25 = 4000 shares on day 1


# Golden case 2. Closes 50, 51, 52 (days 1-3). 2-for-1 split ex day 3 (factor 0.5 for days 1-2)
# and a 1.00 dividend ex day 2 (previous raw close 50 -> factor 1 - 1/50 = 0.98 for day 1 only).
#   day 1: 50 * 0.5 * 0.98 = 24.5 ; day 2: 51 * 0.5 = 25.5 ; day 3: 52
G2 = bars([(D(2020, 2, 3), 50, 50, 50, 50, 10), (D(2020, 2, 4), 51, 51, 51, 51, 10), (D(2020, 2, 5), 52, 52, 52, 52, 10)])
A2 = actions([("split", D(2020, 2, 5), 1.0, 2.0, None), ("dividend", D(2020, 2, 4), None, None, 1.0)])


def test_golden_split_plus_dividend():
    out = adjust_bars(G2, A2, D(2020, 2, 5), Adjustment.SPLIT_DIVIDEND)
    assert out["close"].to_list() == pytest.approx([24.5, 25.5, 52.0])
    only_split = adjust_bars(G2, A2, D(2020, 2, 5), Adjustment.SPLIT)
    assert only_split["close"].to_list() == pytest.approx([25.0, 25.5, 52.0])


def test_reverse_split_factor_above_one_and_positive_prices():
    # GE-style 1-for-8: price 10 -> 80 on the ex-date. Bars before get factor 8.
    out = adjust_bars(bars([(D(2021, 8, 2), 10, 10, 10, 10, 8), (D(2021, 8, 3), 80, 80, 80, 80, 1)]),
                      actions([("split", D(2021, 8, 3), 8.0, 1.0, None)]), D(2021, 8, 3), "split")
    assert out["factor"].to_list() == [8.0, 1.0] and (out["close"] > 0).all()
    assert out["close"].to_list() == [80.0, 80.0]


def test_ex_date_bar_itself_is_not_adjusted():
    f = split_factors(pl.Series([D(2020, 1, 1), D(2020, 1, 2)]), SPLIT4, D(2020, 1, 2))
    assert f.to_list() == [0.25, 1.0]


def test_raw_mode_and_unknown_mode():
    assert adjust_bars(GOLD, SPLIT4, D(2020, 1, 2), "raw")["close"].to_list() == [400.0, 100.0]
    with pytest.raises(ValueError):
        adjust_bars(GOLD, SPLIT4, D(2020, 1, 2), "bogus")


def test_dividend_without_earlier_bar_is_skipped():
    f = dividend_factors(G2, actions([("dividend", D(2020, 2, 3), None, None, 1.0)]), D(2020, 2, 5))
    assert f.to_list() == [1.0, 1.0, 1.0]


def test_property_actions_after_as_of_never_change_earlier_values():
    """Causality: adjusting with all actions equals adjusting with only actions ex_date <= as_of."""
    rng = random.Random(11)
    days = [D(2020, 1, 1) + timedelta(days=i) for i in range(60)]
    b = bars([(d, 100 + i, 101 + i, 99 + i, 100 + i, 10) for i, d in enumerate(days)])
    acts = actions([("split", days[20], 1.0, 4.0, None), ("split", days[40], 1.0, 2.0, None),
                    ("dividend", days[30], None, None, 0.5)])
    for _ in range(100):
        as_of = rng.choice(days)
        full = adjust_bars(b, acts, as_of, "split_dividend")
        trunc = adjust_bars(b.filter(pl.col("trade_date") <= as_of),
                            acts.filter(pl.col("ex_date") <= as_of), as_of, "split_dividend")
        assert full.equals(trunc)


def test_leaky_implementation_is_caught_by_the_property():
    """A leaky adjuster (uses actions after as_of) gives different earlier values; the property would fail."""
    days = [D(2020, 1, 1) + timedelta(days=i) for i in range(10)]
    b = bars([(d, 100.0, 100.0, 100.0, 100.0, 10) for d in days])
    acts = actions([("split", days[8], 1.0, 4.0, None)])
    as_of = days[3]
    honest = adjust_bars(b, acts, as_of, "split")
    leaky = adjust_bars(b, acts, D(2999, 1, 1), "split").filter(pl.col("trade_date") <= as_of)
    assert honest["close"].to_list() != leaky["close"].to_list()


# ---- real data (read only; skipped when absent)

@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) WHERE i.symbol='AAPL'")
        if cur.fetchone()[0] < 100:
            pytest.skip("real AAPL data not loaded")
    yield c
    c.close()


@pytest.mark.parametrize("sym,ex,raw_lo,raw_hi", [("AAPL", D(2020, 8, 31), -0.78, -0.72), ("NVDA", D(2024, 6, 10), -0.92, -0.88)])
def test_real_split_adjusted_return_is_small(real, sym, ex, raw_lo, raw_hi):
    raw = get_bars(real, sym, ex - timedelta(days=10), ex + timedelta(days=5))
    adj = get_bars(real, sym, ex - timedelta(days=10), ex + timedelta(days=5), adjustment="split")

    def ret(df):
        before = df.filter(pl.col("trade_date") < ex).tail(1)["close"][0]
        on = df.filter(pl.col("trade_date") >= ex).head(1)["close"][0]
        return on / before - 1

    assert raw_lo < ret(raw) < raw_hi
    assert abs(ret(adj)) < 0.15
