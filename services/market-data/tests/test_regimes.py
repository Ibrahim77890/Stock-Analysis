"""Regime breakdown (task 04_07)."""

from dataclasses import replace
from datetime import date

import polars as pl
import psycopg
import pytest

from market_data import config
from market_data.backtest import BacktestResult, BacktestSpec, run_backtest, TRADE_SCHEMA
from market_data.regimes import regime_breakdown, regime_labels
from tests.test_validation_split import zero_drift_walk

D = date


def test_golden_two_year_table():
    # equity 100 -> 110, 120 (2021) -> 130, 114 (2022): growth 2021 = 1.20, 2022 = 114/120 = 0.95, total 1.14
    dates = [D(2021, 12, 30), D(2021, 12, 31), D(2022, 1, 3), D(2022, 1, 4)]
    eq = pl.DataFrame({"trade_date": dates, "equity": [110.0, 120.0, 130.0, 114.0], "position": [1, 1, 1, 0]},
                      schema={"trade_date": pl.Date, "equity": pl.Float64, "position": pl.Int8})
    spec = BacktestSpec(symbol="X", start=dates[0], end=dates[-1], initial_cash=100.0)
    res = BacktestResult(spec, eq, pl.DataFrame(schema=TRADE_SCHEMA), True)
    bars = pl.DataFrame({"trade_date": dates})
    out = regime_breakdown(res, bars, "year")
    g = {x["label"]: x for x in out["groups"]}
    assert g["2021"]["growth_factor"] == pytest.approx(1.20) and g["2022"]["growth_factor"] == pytest.approx(0.95)
    assert out["total_growth"] == pytest.approx(1.14) and out["product_of_group_growth"] == pytest.approx(1.14)
    assert g["2021"]["share_in_market"] == 1.0 and g["2022"]["share_in_market"] == 0.5


def test_bad_arguments():
    bars = zero_drift_walk(100, 1)
    res = run_backtest(bars, BacktestSpec(symbol="X", start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=5, slow=20))
    with pytest.raises(ValueError):
        regime_breakdown(res, bars, "month")
    with pytest.raises(ValueError):
        regime_breakdown(res, bars.head(90), "year")  # different dates
    with pytest.raises(ValueError):
        regime_labels(bars.head(20), "vol")  # fewer than 25 bars


def test_every_bar_gets_one_label_and_days_sum_to_rows():
    bars = zero_drift_walk(400, 3)
    spec = BacktestSpec(symbol="X", start=bars["trade_date"][0], end=bars["trade_date"][-1], fast=5, slow=20)
    res = run_backtest(bars, spec)
    for by in ("year", "vol"):
        out = regime_breakdown(res, bars, by)
        assert sum(g["days"] for g in out["groups"]) == res.equity.height == len(regime_labels(bars, by))
        assert out["product_of_group_growth"] == pytest.approx(out["total_growth"], rel=1e-9)
        assert sum(g["trades_started"] for g in out["groups"]) == res.trades.height


def test_changing_the_last_close_does_not_change_any_volatility_label():
    """Labels use volatility known at the previous close, so the last bar's own close cannot influence any label."""
    bars = zero_drift_walk(200, 5)
    changed = bars.with_columns(pl.when(pl.col("trade_date") == bars["trade_date"][-1]).then(pl.col("close") * 3)
                                .otherwise(pl.col("close")).alias("close"))
    assert regime_labels(bars, "vol") == regime_labels(changed, "vol")
    assert regime_labels(bars, "vol")[0] == "warmup"


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


@pytest.mark.parametrize("symbol,start", [("AAPL", D(2020, 7, 27)), ("SPY", D(2018, 11, 1))])
@pytest.mark.parametrize("by", ["year", "vol"])
def test_real_reconciliation(real, symbol, start, by):
    from market_data.read import get_bars
    bars = get_bars(real, symbol, start, D(2025, 12, 31), adjustment="split")
    spec = BacktestSpec(symbol=symbol, start=start, end=D(2025, 12, 31), fast=20, slow=50, slippage_bps=2)
    res = run_backtest(bars, spec)
    out = regime_breakdown(res, bars, by)
    assert out["product_of_group_growth"] == pytest.approx(out["total_growth"], rel=1e-9)
    assert sum(g["days"] for g in out["groups"]) == bars.height
