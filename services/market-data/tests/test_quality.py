import json
from datetime import date, timedelta

import polars as pl

from market_data import quality as q


def frame(rows):
    """rows: (symbol, iso_date, o, h, l, c, v)"""
    return pl.DataFrame(
        [(r[0], date.fromisoformat(r[1]), *r[2:]) for r in rows],
        schema={"symbol": pl.String, "trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64,
                "low": pl.Float64, "close": pl.Float64, "volume": pl.Int64}, orient="row")


def dates(df):
    return [str(d) for d in df["trade_date"]]


def test_duplicate_key():
    pos = frame([("A", "2020-01-02", 1, 1, 1, 1, 1)] * 2)
    assert dates(q.duplicate_key(pos)) == ["2020-01-02"]
    assert q.duplicate_key(frame([("A", "2020-01-02", 1, 1, 1, 1, 1)])).height == 0


def test_ohlc_consistency():
    bars = frame([("A", "2020-01-02", 10, 9, 8, 9.5, 1), ("A", "2020-01-03", 10, 11, 9, 10, 1)])
    assert dates(q.ohlc_consistency(bars)) == ["2020-01-02"]


def test_non_positive_price():
    bars = frame([("A", "2020-01-02", 0, 1, 0, 1, 1), ("A", "2020-01-03", 1, 1, 1, 1, 1)])
    assert dates(q.non_positive_price(bars)) == ["2020-01-02"]


def test_negative_volume_and_zero_volume():
    bars = frame([("A", "2020-01-02", 1, 1, 1, 1, -5), ("A", "2020-01-03", 1, 1, 1, 1, 0),
                  ("A", "2020-01-06", 1, 1, 1, 1, 7)])
    assert dates(q.negative_volume(bars)) == ["2020-01-02"]
    assert dates(q.zero_volume_day(bars)) == ["2020-01-03"]


def split_scenario():
    bars = frame([("A", "2020-08-28", 400, 405, 395, 400, 1), ("A", "2020-08-31", 100, 102, 98, 100, 1),
                  ("A", "2020-09-01", 101, 103, 99, 102, 1)])
    sessions = [date(2020, 8, 28), date(2020, 8, 31), date(2020, 9, 1)]
    return bars, sessions


def test_large_move_explained_by_split():
    bars, sessions = split_scenario()
    splits = pl.DataFrame({"symbol": ["A"], "ex_date": [date(2020, 8, 31)]})
    out = q.large_move(bars, splits=splits, sessions=sessions)
    assert dates(out) == ["2020-08-31"]
    assert json.loads(out["detail"][0])["explained_by_split"] is True


def test_large_move_unexplained_without_split_row():
    bars, sessions = split_scenario()
    out = q.large_move(bars, splits=pl.DataFrame(schema={"symbol": pl.String, "ex_date": pl.Date}), sessions=sessions)
    assert json.loads(out["detail"][0])["explained_by_split"] is False


def test_large_move_normal_day_not_flagged():
    bars = frame([("A", "2020-01-02", 100, 101, 99, 100, 1), ("A", "2020-01-03", 100, 111, 99, 110, 1)])
    assert q.large_move(bars).height == 0


def test_stale_price():
    flat = [("A", f"2020-01-{d:02d}", 5, 5, 5, 5, 0) for d in (2, 3, 6, 7, 8)]
    moving = [("B", f"2020-01-{d:02d}", 5 + d, 6 + d, 4 + d, 5 + d, 1) for d in (2, 3, 6, 7, 8)]
    out = q.stale_price(frame(flat + moving))
    assert out["symbol"].to_list() == ["A"] and dates(out) == ["2020-01-08"]
    assert q.stale_price(frame(flat[:4])).height == 0


def test_calendar_thanksgiving_not_missing_but_deleted_day_is():
    sessions = q.xnys_sessions(date(2023, 11, 20), date(2023, 11, 28))
    assert date(2023, 11, 23) not in sessions  # Thanksgiving
    present = [d for d in sessions if d != date(2023, 11, 21)]
    bars = pl.DataFrame({"symbol": ["AAPL"] * len(present), "trade_date": present})
    out = q.missing_session(bars, sessions)
    assert dates(out) == ["2023-11-21"]
    assert json.loads(out["detail"][0])["classification"] == "provider_gap"


def test_missing_session_classifies_outside_range():
    sessions = q.xnys_sessions(date(2023, 1, 2), date(2023, 1, 13))
    present = sessions[2:-2]
    out = q.missing_session(pl.DataFrame({"symbol": ["A"] * len(present), "trade_date": present}), sessions)
    cls = [json.loads(d)["classification"] for d in out["detail"]]
    assert cls == ["before_first_bar"] * 2 + ["after_last_bar"] * 2


def test_rules_are_deterministic():
    bars, sessions = split_scenario()
    a = q.run_rules(bars, pl.DataFrame(schema={"symbol": pl.String, "ex_date": pl.Date}), sessions)
    b = q.run_rules(bars, pl.DataFrame(schema={"symbol": pl.String, "ex_date": pl.Date}), sessions)
    assert {k: v.height for k, v in a.items()} == {k: v.height for k, v in b.items()}
