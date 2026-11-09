"""Load the versioned symbol universe."""

from pathlib import Path

import polars as pl

from market_data.core.config import UNIVERSE_FILE

UNIVERSE_SCHEMA = {
    "symbol": pl.String,
    "name": pl.String,
    "type": pl.String,
    "sector": pl.String,
    "reason_included": pl.String,
}


def load_universe(path: Path | str = UNIVERSE_FILE) -> pl.DataFrame:
    return pl.read_csv(path, schema_overrides=UNIVERSE_SCHEMA)


def symbols(path: Path | str = UNIVERSE_FILE) -> list[str]:
    return load_universe(path)["symbol"].to_list()
