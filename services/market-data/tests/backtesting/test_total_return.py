from dataclasses import replace
from datetime import date

import polars as pl
import psycopg
import pytest

from market_data.core import config
from market_data.market.adjust import adjust_bars
from market_data.market.adjust_check import SPREAD_TOLERANCE, adjustment_vs_vendor
from market_data.backtesting.backtest import BacktestSpec, backtest_from_db, check_engine_truncation, run_backtest
from market_data.backtesting.research import canonical_json, canonical_spec, config_hash, dataset_fingerprint, spec_from_dict
from market_data.market.read import get_actions, get_bars

from tests.backtesting.test_backtest import leaky_runner

D = date

# Sprint 03 saved runs (docs/02-domain/backtest-worked-example.md): hashes must never change.
SAVED = {"AAPL": "782fe34644ac0bb11e100a12fc3eaf734aebf55735f0e35a04e47984e91be32d",
         "SPY": "15e2afd147e37809cb50cb1319edc942c30a72445757b9d359177a684731b210"}


@pytest.fixture(scope="module")
def real():
    try:
        c = psycopg.connect(config.database_url(), connect_timeout=3)
    except Exception as exc:  # noqa: BLE001
        pytest.skip(f"real database unavailable: {exc}")
    with c.cursor() as cur:
        cur.execute("SELECT count(*) FROM market.bar_daily b JOIN market.instrument i USING (instrument_id) "
                    "WHERE i.symbol = 'AAPL' AND b.source = 'tiingo'")
        if cur.fetchone()[0] < 3000:
            pytest.skip("real Tiingo AAPL data not loaded")
    yield c
    c.close()


def base_spec(**kw):
    return BacktestSpec(symbol="AAPL", start=D(2020, 7, 27), end=D(2025, 12, 31), fast=20, slow=50, **kw)


# ---- hashes

def test_defaults_do_not_appear_in_the_canonical_spec_or_dict():
    s = base_spec()
    assert "source" not in canonical_spec(s) and "price_basis" not in canonical_spec(s)
    assert "source" not in s.to_dict() and "price_basis" not in s.to_dict()
    t = base_spec(source="tiingo", price_basis="split_dividend")
    assert canonical_spec(t)["source"] == "tiingo" and canonical_spec(t)["price_basis"] == "split_dividend"
    assert spec_from_dict(t.to_dict()) == t and spec_from_dict(s.to_dict()) == s
    # an old stored spec (no such keys) still loads with the defaults
    assert spec_from_dict(s.to_dict()).price_basis == "split"


@pytest.mark.parametrize("change", [{"price_basis": "split_dividend"}, {"source": "tiingo"},
                                    {"source": "tiingo", "price_basis": "split_dividend"}])
def test_changing_basis_or_source_changes_config_hash(change):
    fp = "f" * 64
    assert config_hash(base_spec(**change), fp) != config_hash(base_spec(), fp)


def test_invalid_basis_rejected():
    with pytest.raises(ValueError):
        base_spec(price_basis="total")
    with pytest.raises(ValueError):
        base_spec(source="")


def test_sprint_03_saved_run_hashes_recompute_unchanged(real):
    for sym, expected in SAVED.items():
        start = D(2018, 11, 1) if sym == "SPY" else D(2020, 7, 27)   # as saved (SPY included its stray early bar)
        s = BacktestSpec(symbol=sym, start=start, end=D(2025, 12, 31), fast=20, slow=50,
                         slippage_bps=5, commission_bps=1)   # the saved Sprint 03 runs used 5 bps slippage + 1 bp commission
        bars = get_bars(real, sym, s.start, s.end, adjustment="split")
        assert config_hash(s, dataset_fingerprint(bars)) == expected, sym


# ---- golden dividend case

def test_golden_six_bars_one_dividend():
    dates = [D(2022, 1, 3) + (D(2022, 1, 4) - D(2022, 1, 3)) * i for i in range(6)]
    closes = [100.0, 101.0, 102.0, 103.0, 104.0, 105.0]
    bars = pl.DataFrame({"trade_date": dates, "open": closes, "high": closes, "low": closes, "close": closes,
                         "volume": [1000] * 6})
    actions = pl.DataFrame({"action_type": ["dividend"], "ex_date": [dates[3]], "split_from": [None],
                            "split_to": [None], "cash_amount": [1.0]},
                           schema={"action_type": pl.String, "ex_date": pl.Date, "split_from": pl.Float64,
                                   "split_to": pl.Float64, "cash_amount": pl.Float64})
    adj = adjust_bars(bars, actions, dates[-1], "split_dividend")
    f = 1 - 1.0 / 102.0     # last close before the ex-date is 102
    assert adj["close"].to_list() == pytest.approx([100 * f, 101 * f, 102 * f, 103.0, 104.0, 105.0])
    assert adj["close"][-1] / adj["close"][0] - 1 == pytest.approx(105 / (100 * f) - 1)   # 6.0396 %, price-only is 5 %
    split_only = adjust_bars(bars, actions, dates[-1], "split")
    assert split_only["close"].to_list() == closes
    # nothing after the cursor is used: before the ex-date the dividend is unknown
    early = adjust_bars(bars, actions, dates[2], "split_dividend")
    assert early["close"].to_list() == closes[:3]


# ---- causality on real data

def ex_dates(conn, symbol):
    a = get_actions(conn, symbol, source="tiingo")
    return (a.filter(pl.col("action_type") == "dividend")["ex_date"].to_list(),
            a.filter(pl.col("action_type") == "split")["ex_date"].to_list())


def tiingo_loader(conn, symbol, start):
    return lambda t: get_bars(conn, symbol, start, t, source="tiingo", adjustment="split_dividend")


@pytest.mark.parametrize("symbol", ["AAPL", "SPY"])
def test_split_dividend_engine_truncation_passes(real, symbol):
    start, end = D(2019, 1, 2), D(2021, 12, 31)
    divs, splits = ex_dates(real, symbol)
    cuts = [d for d in divs if start < d < end][:2] if symbol == "AAPL" else [d for d in divs if start < d < end][:3]
    cuts_around = [d for d in splits if start < d < end]
    s = BacktestSpec(symbol=symbol, start=start, end=end, fast=5, slow=20, slippage_bps=2, source="tiingo",
                     price_basis="split_dividend")
    assert len(cuts) >= 2
    bad = check_engine_truncation(s, tiingo_loader(real, symbol, start), cut_points=50, seed=7,
                                  extra_cut_dates=cuts + cuts_around + [D(2020, 8, 28), D(2020, 8, 31), D(2020, 9, 1)])
    assert bad == []


def test_split_dividend_truncation_catches_a_leaky_engine(real):
    start, end = D(2019, 1, 2), D(2021, 12, 31)
    s = BacktestSpec(symbol="AAPL", start=start, end=end, fast=5, slow=20, source="tiingo", price_basis="split_dividend")
    bad = check_engine_truncation(s, tiingo_loader(real, "AAPL", start), cut_points=50, seed=7, runner=leaky_runner)
    assert bad


def test_accounting_identity_holds_with_split_dividend(real):
    s = base_spec(commission_bps=1, slippage_bps=2, source="tiingo", price_basis="split_dividend")
    bars, r = backtest_from_db(real, s)
    assert s.initial_cash + r.trades["pnl"].sum() == pytest.approx(r.equity["equity"][-1], rel=1e-9)
    assert bars.height > 1300


def test_total_return_exceeds_price_return_for_a_dividend_payer(real):
    from market_data.backtesting.backtest import buy_and_hold
    out = {}
    for basis in ("split", "split_dividend"):
        s = BacktestSpec(symbol="KO", start=D(2010, 1, 4), end=D(2025, 12, 31), source="tiingo", price_basis=basis)
        bars, _ = backtest_from_db(real, s)
        eq = buy_and_hold(bars, s).equity["equity"]
        out[basis] = eq[-1] / eq[0]
    assert out["split_dividend"] > out["split"]


def test_backtest_on_tiingo_differs_from_default_request(real):
    a = backtest_from_db(real, base_spec())[1].equity["equity"][-1]
    b = backtest_from_db(real, base_spec(source="tiingo", price_basis="split_dividend"))[1].equity["equity"][-1]
    assert a != b


# ---- external check against the vendor

@pytest.mark.parametrize("symbol", ["AAPL", "KO", "JNJ", "XOM", "MSFT"])
def test_our_dividend_adjustment_tracks_vendor_adjusted_close(real, symbol):
    try:
        r = adjustment_vs_vendor(real, symbol)
    except FileNotFoundError:
        pytest.skip("Tiingo raw file not available locally")
    assert r["n"] > 4000
    assert r["spread_p95_over_p5"] <= SPREAD_TOLERANCE, r
