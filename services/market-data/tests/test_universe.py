import polars as pl

from market_data.universe import load_universe


def test_universe_shape():
    df = load_universe()
    assert 45 <= df.height <= 60
    assert df["symbol"].n_unique() == df.height
    assert df.filter(pl.col("reason_included").str.len_chars() == 0).height == 0
    assert set(df["type"].unique()) <= {"stock", "etf"}


def test_universe_contains_split_cases():
    syms = set(load_universe()["symbol"])
    assert {"AAPL", "TSLA", "NVDA", "AMZN", "GOOGL", "WMT"} <= syms
