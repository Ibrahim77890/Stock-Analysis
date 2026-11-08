"""Backtest engine (task 03_02), metrics (03_03) and engine causality / look-ahead (03_04)."""

import random
from dataclasses import replace
from datetime import date, timedelta

import polars as pl
import psycopg
import pytest

from market_data import config
from market_data.backtest import (
    BacktestSpec, backtest_from_db, buy_and_hold, check_engine_truncation, compare_fill_models, full_run,
    run_backtest, sma_crossover,
)
from market_data.metrics import max_drawdown, summarise

D = date

# Golden series (hand computed in the comments below). fast=2, slow=3.
CLOSES = [10, 11, 12, 11, 9, 8, 9, 10]
OPENS = [10, 10.5, 11.5, 12.5, 10.5, 8.5, 8, 9.5]


def make_bars(closes=CLOSES, opens=OPENS, start=D(2024, 1, 1)) -> pl.DataFrame:
    dates = [start + timedelta(days=i) for i in range(len(closes))]
    return pl.DataFrame({
        "trade_date": dates, "open": [float(x) for x in opens],
        "high": [max(o, c) + 0.5 for o, c in zip(opens, closes)],
        "low": [min(o, c) - 0.5 for o, c in zip(opens, closes)],
        "close": [float(x) for x in closes], "volume": [1000] * len(closes),
    })


def spec(**kw) -> BacktestSpec:
    base = dict(symbol="X", start=D(2024, 1, 1), end=D(2024, 1, 8), fast=2, slow=3, initial_cash=1000.0)
    return BacktestSpec(**{**base, **kw})


def test_targets_match_hand_computed_signal():
    # SMA2: -,10.5,11.5,11.5,10,8.5,8.5,9.5  SMA3: -,-,11,11.333,10.667,9.333,8.667,9
    assert sma_crossover(make_bars(), 2, 3).to_list() == [0, 0, 1, 1, 0, 0, 0, 1]


def test_golden_a_zero_costs():
    # signal 1 at close of day 3 -> buy at OPEN of day 4 = 12.5, 1000/12.5 = 80 shares.
    # signal 0 at close of day 5 -> sell at OPEN of day 6 = 8.5 -> cash 680. Last signal (day 8) has no next bar.
    r = run_backtest(make_bars(), spec())
    assert r.equity["equity"].to_list() == pytest.approx([1000, 1000, 1000, 880, 720, 680, 680, 680], abs=1e-9)
    assert r.equity["position"].to_list() == [0, 0, 0, 1, 1, 0, 0, 0]
    t = r.trades.row(0, named=True)
    assert (t["entry_price"], t["exit_price"], t["shares"]) == (12.5, 8.5, 80.0)
    assert t["pnl"] == pytest.approx(-320.0) and t["closed"] and r.trades.height == 1


def test_golden_b_costs_and_accounting_identity():
    # buy price 12.5*1.0005 = 12.50625; shares = 1000/(12.50625*1.001) = 79.88013985
    # sell price 8.5*0.9995 = 8.49575; proceeds 678.6416981; commission 0.6786417; cash 677.9630564
    r = run_backtest(make_bars(), spec(commission_bps=10, slippage_bps=5))
    final = r.equity["equity"][-1]
    assert final == pytest.approx(677.9630564338, abs=1e-8)
    assert 1000 + r.trades["pnl"].sum() == pytest.approx(final, abs=1e-8)  # ADR 0009 identity
    assert r.trades["costs"].sum() == pytest.approx(2.5163841656, abs=1e-8)


def test_open_position_is_recorded_as_open_trade_and_identity_holds():
    closes = [10, 11, 12, 13, 14, 15]
    opens = [10, 10.5, 11.5, 12.5, 13.5, 14.5]
    r = run_backtest(make_bars(closes, opens), spec(end=D(2024, 1, 6)))
    assert r.trades.height == 1 and not r.trades["closed"][0]
    assert 1000 + r.trades["pnl"].sum() == pytest.approx(r.equity["equity"][-1], abs=1e-9)


def test_flat_prices_never_trade():
    r = run_backtest(make_bars([10] * 10, [10] * 10), spec(end=D(2024, 1, 10)))
    assert r.trades.height == 0 and set(r.equity["equity"]) == {1000.0}


def test_same_close_is_flagged_not_realisable_and_fills_at_signal_close():
    r = run_backtest(make_bars(), spec(fill_model="same_close"))
    assert r.realisable is False
    assert r.trades["entry_price"][0] == 12.0  # day-3 close, the bar that produced the signal


def test_a_fill_at_the_signal_close_is_caught_by_the_golden_case():
    """Negative test: an engine that fills at the signal bar's close cannot reproduce golden case A."""
    leaky = run_backtest(make_bars(), spec(fill_model="same_close"))
    honest = run_backtest(make_bars(), spec())
    assert leaky.equity["equity"].to_list() != honest.equity["equity"].to_list()


@pytest.mark.parametrize("kw", [dict(fast=3, slow=3), dict(fast=0), dict(commission_bps=-1), dict(slippage_bps=-0.1),
                                dict(initial_cash=0), dict(fill_model="bogus"), dict(symbol="")])
def test_invalid_specs_raise(kw):
    with pytest.raises(ValueError):
        spec(**kw)


def test_invalid_bars_raise():
    good = make_bars()
    with pytest.raises(ValueError):
        run_backtest(good.reverse(), spec())  # unsorted
    with pytest.raises(ValueError):
        run_backtest(pl.concat([good, good.head(1)]).sort("trade_date"), spec())  # duplicate date
    with pytest.raises(ValueError):
        run_backtest(good.with_columns(pl.when(pl.col("trade_date") == D(2024, 1, 3)).then(0.0)
                                       .otherwise(pl.col("close")).alias("close")), spec())  # price <= 0
    with pytest.raises(ValueError):
        run_backtest(good.head(1), spec())  # too few bars
    with pytest.raises(ValueError):
        run_backtest(good.drop("open"), spec())


def test_deterministic_two_runs_equal():
    a, b = run_backtest(make_bars(), spec(slippage_bps=3)), run_backtest(make_bars(), spec(slippage_bps=3))
    assert a.equity.equals(b.equity) and a.trades.equals(b.trades)


# ---- metrics (03_03)

def test_metrics_golden_values():
    from market_data.metrics import cagr, sharpe, total_return, annualised_volatility
    eq = [100, 110, 99, 120]
    assert total_return(eq) == pytest.approx(0.20) and max_drawdown(eq) == pytest.approx(-0.10)
    const = [100 * 1.001 ** i for i in range(253)]  # 252 identical daily returns
    assert cagr(const) == pytest.approx(1.001 ** 252 - 1, abs=1e-9)
    assert sharpe(const) is None and annualised_volatility(const) == pytest.approx(0.0, abs=1e-9)


def test_sharpe_matches_numpy_independent_computation():
    import numpy as np
    from market_data.metrics import sharpe
    rng = np.random.default_rng(3)
    eq = 100 * np.cumprod(1 + rng.normal(0.0005, 0.01, 500))
    r = eq[1:] / eq[:-1] - 1
    assert sharpe(list(eq)) == pytest.approx(r.mean() / r.std(ddof=1) * np.sqrt(252), abs=1e-12)


def test_metrics_properties_seeded():
    from market_data.metrics import total_return
    rng = random.Random(9)
    for _ in range(50):
        eq = [100.0]
        for _ in range(rng.randrange(2, 200)):
            eq.append(eq[-1] * (1 + rng.uniform(-0.05, 0.05)))
        assert -1.0 <= max_drawdown(eq) <= 0.0
        assert total_return(eq) == pytest.approx(eq[-1] / eq[0] - 1)


def test_metrics_reject_bad_input_and_return_none_for_undefined():
    from market_data.metrics import sharpe, cagr
    with pytest.raises(ValueError):
        max_drawdown([])
    with pytest.raises(ValueError):
        max_drawdown([100, -5, 90])
    assert sharpe([100, 101]) is None and cagr([100]) is None


def test_summarise_and_benchmark_through_same_engine():
    out = full_run(make_bars(), spec())
    assert out["metrics"]["trades"] == 1 and out["metrics"]["win_rate"] == 0.0
    b = buy_and_hold(make_bars(), spec())
    # buy-and-hold: signal on day 1 close, fill at open of day 2 (10.5), 1000/10.5 shares, marked at last close 10
    assert b.equity["equity"][-1] == pytest.approx(1000 / 10.5 * 10)
    assert out["benchmark_metrics"]["total_return"] == pytest.approx(10 / 10.5 - 1)
    assert 1000 + b.trades["pnl"].sum() == pytest.approx(b.equity["equity"][-1])
    assert summarise(b.equity, b.trades)["exposure"] == pytest.approx(7 / 8)


# ---- causality and look-ahead detector (03_04)

def synthetic_trend(n=300, seed=4) -> pl.DataFrame:
    rng = random.Random(seed)
    price, rows = 100.0, []
    for i in range(n):
        gap = rng.uniform(-0.01, 0.025)
        o = price * (1 + gap)
        c = o * (1 + rng.uniform(-0.01, 0.012))
        rows.append((D(2020, 1, 1) + timedelta(days=i), o, max(o, c) * 1.002, min(o, c) * 0.998, c, 1000))
        price = c
    return pl.DataFrame(rows, schema=["trade_date", "open", "high", "low", "close", "volume"], orient="row")


def test_engine_truncation_passes_on_synthetic_bars():
    bars = synthetic_trend()
    s = spec(start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=5, slow=20, slippage_bps=2)
    assert check_engine_truncation(s, lambda t: bars.filter(pl.col("trade_date") <= t), cut_points=50) == []


def leaky_runner(bars, s):
    """Centred SMA signal: uses future bars, so the truncation test must fail."""
    def centred(df, _spec):
        f = df.select(pl.col("close").rolling_mean(window_size=s.fast, center=True).alias("f")).to_series()
        sl = df.select(pl.col("close").rolling_mean(window_size=s.slow, center=True).alias("s")).to_series()
        return pl.DataFrame({"f": f, "s": sl}).select(
            pl.when(pl.col("f") > pl.col("s")).then(1).otherwise(0).cast(pl.Int8)).to_series()
    return run_backtest(bars, s, targets=centred)


def test_truncation_check_catches_a_leaky_engine():
    bars = synthetic_trend()
    s = spec(start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=5, slow=20)
    bad = check_engine_truncation(s, lambda t: bars.filter(pl.col("trade_date") <= t), cut_points=50, runner=leaky_runner)
    assert len(bad) > 0


def test_same_close_beats_next_open_on_gapping_synthetic_data():
    bars = synthetic_trend()
    s = spec(start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=5, slow=20)
    cmp = compare_fill_models(bars, s)
    assert cmp["total_return_difference"] > 0 and cmp["same_close"]["realisable"] is False
    assert "look-ahead" in cmp["warning"]


# ---- real data (read-only on the real database; skipped when absent)

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


def aapl_spec(**kw):
    return BacktestSpec(symbol="AAPL", start=D(2020, 7, 27), end=D(2023, 12, 31), fast=5, slow=20, **kw)  # AAPL data starts 2020-07-27


def test_real_aapl_across_split_has_no_split_artefact_and_identity_holds(real):
    s = aapl_spec(commission_bps=1, slippage_bps=2)
    bars, r = backtest_from_db(real, s)
    rets = r.equity["equity"].pct_change().drop_nulls()
    assert rets.min() > -0.3
    assert s.initial_cash + r.trades["pnl"].sum() == pytest.approx(r.equity["equity"][-1], rel=1e-9)
    assert max_drawdown(r.equity) > -1


@pytest.mark.parametrize("symbol", ["AAPL", "SPY"])
def test_real_engine_truncation_across_split(real, symbol):
    from market_data.read import get_bars
    s = BacktestSpec(symbol=symbol, start=D(2020, 7, 27), end=D(2023, 12, 31), fast=5, slow=20, slippage_bps=2)
    loader = lambda t: get_bars(real, symbol, s.start, t, adjustment="split")  # noqa: E731
    # explicit cuts around the 2020-08-31 AAPL 4-for-1 split (the day before, the ex-date, the day after)
    around = [D(2020, 8, 28), D(2020, 8, 31), D(2020, 9, 1)]
    assert check_engine_truncation(s, loader, cut_points=50, seed=7, extra_cut_dates=around if symbol == "AAPL" else ()) == []


def test_real_engine_respects_a_cursor_end_date(real):
    rng = random.Random(11)
    for _ in range(50):
        end = D(2020, 9, 15) + timedelta(days=rng.randrange(0, 1000))
        _, r = backtest_from_db(real, replace(aapl_spec(), end=end))
        assert r.equity["trade_date"].max() <= end


def test_real_fill_model_comparison_runs(real):
    bars, _ = backtest_from_db(real, aapl_spec())
    cmp = compare_fill_models(bars, aapl_spec())
    assert isinstance(cmp["total_return_difference"], float)
