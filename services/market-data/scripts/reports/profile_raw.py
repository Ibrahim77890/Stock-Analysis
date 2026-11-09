"""Profile the raw bar files (task 01_05). Observes and documents only; fixes nothing.

Usage (from services/market-data):
    uv run python scripts/reports/profile_raw.py [--out ../../docs/02-domain/data-profile-v1.md]

Output tables are deterministic (sorted, no timestamps), so two runs on the same files
give byte-identical tables. Runtime and peak memory are printed to stderr, to be copied
into the report by hand because they differ between runs by nature.
"""

import argparse
import sys
import time
import tracemalloc
from datetime import date
from pathlib import Path

import polars as pl

from market_data.core import config
from market_data.ingestion.download import raw_files
from market_data.ingestion.load import normalise_actions, normalise_bars
from market_data.core.universe import symbols


def load_all(data_dir: Path, syms: list[str]) -> tuple[pl.DataFrame, list[str]]:
    frames, missing = [], []
    for s in syms:
        files = raw_files(data_dir / "raw" / "alpaca" / "bars_1d", s)
        if not files:
            missing.append(s)
            continue
        frames.append(normalise_bars(pl.read_parquet(files[-1]), s))
    return pl.concat(frames).sort("symbol", "trade_date"), missing


def per_symbol(bars: pl.DataFrame) -> pl.DataFrame:
    o, h, l, c = (pl.col(x) for x in ("open", "high", "low", "close"))
    b = bars.with_columns((c / c.shift(1).over("symbol") - 1).alias("ret"))
    return b.group_by("symbol").agg(
        pl.len().alias("rows"), pl.col("trade_date").min().alias("first_date"),
        pl.col("trade_date").max().alias("last_date"),
        (pl.len() - pl.col("trade_date").n_unique()).alias("dup_dates"),
        ((h < pl.max_horizontal(o, c)) | (l > pl.min_horizontal(o, c))).sum().alias("bad_ohlc"),
        (pl.col("volume") == 0).sum().alias("zero_volume"),
        pl.any_horizontal(pl.col("open", "high", "low", "close", "volume", "trade_count", "vwap").is_null()).sum().alias("rows_with_null"),
        pl.col("ret").abs().max().round(4).alias("max_abs_return"),
    ).sort("symbol")


def missing_weekdays(bars: pl.DataFrame) -> pl.DataFrame:
    """Weekdays between each symbol's first and last date with no bar (unclassified; see 01_08)."""
    rows = []
    for (sym,), g in bars.group_by("symbol", maintain_order=True):
        lo, hi = g["trade_date"].min(), g["trade_date"].max()
        weekdays = pl.date_range(lo, hi, "1d", eager=True).filter(pl.date_range(lo, hi, "1d", eager=True).dt.weekday() <= 5)
        rows.append((sym, weekdays.len() - g["trade_date"].n_unique()))
    return pl.DataFrame(rows, schema=["symbol", "missing_weekdays"], orient="row").sort("symbol")


def top_moves(bars: pl.DataFrame, splits: pl.DataFrame, n: int = 10) -> pl.DataFrame:
    b = bars.with_columns((pl.col("close") / pl.col("close").shift(1).over("symbol") - 1).alias("ret"))
    top = b.filter(pl.col("ret").is_not_null()).sort(pl.col("ret").abs(), "symbol", descending=[True, False]).head(n)
    ex = {(r["symbol"], r["ex_date"]) for r in splits.iter_rows(named=True)}
    return top.select("symbol", "trade_date", pl.col("ret").round(4)).with_columns(
        pl.struct("symbol", "trade_date").map_elements(
            lambda s: "yes" if (s["symbol"], s["trade_date"]) in ex else "no", return_dtype=pl.String
        ).alias("explained_by_split"))


def split_demo(bars: pl.DataFrame, symbol: str, ex: date, ratio: float) -> str:
    g = bars.filter(pl.col("symbol") == symbol).sort("trade_date")
    before = g.filter(pl.col("trade_date") < ex).tail(1)
    after = g.filter(pl.col("trade_date") >= ex).head(1)
    if before.is_empty() or after.is_empty():
        return f"- {symbol}: no bars around {ex}"
    pb, pa = before["close"][0], after["close"][0]
    raw_ret, adj_ret = pa / pb - 1, pa * ratio / pb - 1
    return (f"- {symbol} around {ex}: raw close {pb:.4f} ({before['trade_date'][0]}) -> {pa:.4f} ({after['trade_date'][0]}); "
            f"unadjusted return {raw_ret:+.2%}; with the {ratio:g}-for-1 split applied by hand: {adj_ret:+.2%}")


def md_table(df: pl.DataFrame) -> str:
    cols = df.columns
    out = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    out += ["| " + " | ".join(str(v) for v in row) + " |" for row in df.iter_rows()]
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(config.DOCS_DIR / "02-domain" / "data-profile-v1.md"))
    ap.add_argument("--data-dir", default=str(config.DATA_DIR))
    args = ap.parse_args()
    t0 = time.perf_counter()
    tracemalloc.start()

    data_dir = Path(args.data_dir)
    bars, missing = load_all(data_dir, symbols())
    action_files = raw_files(data_dir / "raw" / "alpaca" / "corporate_actions", "corporate_actions")
    actions = normalise_actions(pl.read_parquet(action_files[-1])) if action_files else None
    splits = (actions.filter(pl.col("action_type") == "split").select("symbol", pl.col("ex_date"))
              if actions is not None else pl.DataFrame(schema={"symbol": pl.String, "ex_date": pl.Date}))

    stats = per_symbol(bars).join(missing_weekdays(bars), on="symbol").sort("symbol")
    parts = ["# Data profile v1 (raw Alpaca daily bars)", "",
             f"Generated by `services/market-data/scripts/profile_raw.py`. {bars.height:,} rows, "
             f"{bars['symbol'].n_unique()} symbols. Symbols without a raw file: {', '.join(missing) or 'none'}.", "",
             "## Per symbol", "", md_table(stats), "",
             "`missing_weekdays` counts weekdays without a bar (holidays included); classification is done in task 01_08.", "",
             "## Ten largest absolute daily moves", "", md_table(top_moves(bars, splits)), "",
             "## Split demonstration (raw vs split-adjusted by hand)", "",
             split_demo(bars, "AAPL", date(2020, 8, 31), 4), split_demo(bars, "NVDA", date(2024, 6, 10), 10), "",
             "## Surprises", "", "_Fill in by hand after reading the tables above (at least one finding, or 'none' with evidence)._", "",
             "## Decisions this implies for the schema", "", "_Fill in by hand (column types, nullable columns, etc.)._", "",
             "## Run cost", "", "_Paste runtime and peak memory printed by the script (stderr)._", ""]
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text("\n".join(parts), encoding="utf-8")
    peak = tracemalloc.get_traced_memory()[1] / 2**20
    print(f"runtime {time.perf_counter() - t0:.1f}s, peak Python-traced memory {peak:.0f} MiB", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
