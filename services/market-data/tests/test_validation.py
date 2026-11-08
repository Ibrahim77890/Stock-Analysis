from tests.conftest import make_bars

from market_data.load import normalise_bars, normalise_actions, validate_actions, validate_bars
import polars as pl


def validate(rows, known=("AAA",)):
    return validate_bars(normalise_bars(make_bars("AAA", rows), "AAA"), set(known))


GOOD = ("2020-01-02", 10.0, 11.0, 9.0, 10.5, 100)


def test_good_row_passes():
    valid, rejected = validate([GOOD])
    assert valid.height == 1 and rejected.height == 0
    assert str(valid["trade_date"][0]) == "2020-01-02"


def test_each_hard_rule_has_its_reason():
    cases = {
        "high_below_ohlc": ("2020-01-03", 10.0, 10.2, 9.0, 10.5, 100),   # high < close
        "low_above_ohlc": ("2020-01-03", 10.0, 11.0, 10.2, 10.5, 100),   # low > open
        "negative_volume": ("2020-01-03", 10.0, 11.0, 9.0, 10.5, -1),
        "non_positive_price": ("2020-01-03", 0.0, 11.0, 0.0, 10.5, 1),
    }
    for reason, row in cases.items():
        valid, rejected = validate([GOOD, row])
        assert valid.height == 1, reason
        assert rejected["reason"].to_list() == [reason]


def test_duplicate_date_second_row_rejected():
    valid, rejected = validate([GOOD, GOOD])
    assert valid.height == 1 and rejected["reason"].to_list() == ["duplicate_key"]


def test_unknown_symbol_rejected():
    valid, rejected = validate([GOOD], known=("BBB",))
    assert valid.height == 0 and rejected["reason"].to_list() == ["unknown_symbol"]


def test_null_rejected():
    raw = make_bars("AAA", [GOOD]).with_columns(pl.lit(None, pl.Float64).alias("c"))
    valid, rejected = validate_bars(normalise_bars(raw, "AAA"), {"AAA"})
    assert rejected["reason"].to_list() == ["null_value"]


def test_midnight_eastern_maps_to_same_trade_date_in_both_dst_offsets():
    # 04:00Z in summer (EDT) and 05:00Z in winter (EST) are both 00:00 New York.
    raw = pl.DataFrame({"t": ["2020-07-01T04:00:00Z", "2020-12-01T05:00:00Z"], "o": [1.0, 1.0],
                        "h": [1.0, 1.0], "l": [1.0, 1.0], "c": [1.0, 1.0], "v": [1, 1]})
    out = normalise_bars(raw, "AAA")
    assert [str(d) for d in out["trade_date"]] == ["2020-07-01", "2020-12-01"]


def test_actions_split_and_dividend():
    raw = pl.DataFrame({
        "action_type": ["forward_split", "cash_dividend", "forward_split", "forward_split"],
        "symbol": ["AAA", "AAA", "AAA", "ZZZ"], "ex_date": ["2020-08-31", "2020-02-01", "2020-09-01", "2020-01-01"],
        "new_rate": [4.0, None, -1.0, 2.0], "old_rate": [1.0, None, 1.0, 1.0], "rate": [None, 0.5, None, None],
    })
    valid, rejected = validate_actions(normalise_actions(raw), {"AAA"})
    assert valid.height == 2
    assert sorted(rejected["reason"].to_list()) == ["invalid_split_ratio", "unknown_symbol"]


def test_same_day_dividends_are_summed_not_rejected():
    from market_data.load import merge_same_day_dividends

    raw = pl.DataFrame({"action_type": ["cash_dividend", "cash_dividend"], "symbol": ["AAA", "AAA"],
                        "ex_date": ["2020-03-20", "2020-03-20"], "new_rate": [None, None],
                        "old_rate": [None, None], "rate": [0.25, 0.10]})
    valid, rejected = validate_actions(merge_same_day_dividends(normalise_actions(raw)), {"AAA"})
    assert rejected.height == 0 and valid["cash_amount"].to_list() == [0.35]
