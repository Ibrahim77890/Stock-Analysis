"""Backtest engine v1: one asset, long-only, daily bars (ADR 0009).

Pure functions: bars in, equity curve and trades out. No database inside `run_backtest`.

Model (see docs/04-adr/0009-backtest-execution-model.md):
- signal at the close of day t: target 1 if SMA(fast) > SMA(slow) (both defined), else 0;
- `next_open`: the order is filled at the open of day t+1 (realisable);
- `same_close`: filled at the close of day t (NOT realisable, teaching mode);
- buy fills at price*(1+slippage), sell fills at price*(1-slippage), commission = bps of the
  fill value on every fill; all-in / all-out with fractional shares;
- equity is marked to the close each day; a position still open on the last bar is recorded as an
  open trade valued at the last close with no exit cost, so that
  final equity = initial cash + sum(trade pnl) holds exactly (up to float rounding).
"""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, replace
from datetime import date
from typing import Callable, Sequence

import polars as pl

from . import indicators
from .metrics import summarise

ENGINE_VERSION = "1"
FILL_MODELS = ("next_open", "same_close")
PRICE_BASES = ("split", "split_dividend")  # 'split' is the Sprint 03 default; dividends enter only with 'split_dividend'
DEFAULT_SOURCE = "alpaca"
REQUIRED_COLUMNS = ("trade_date", "open", "high", "low", "close")
TRADE_SCHEMA = {
    "trade_no": pl.Int64, "entry_date": pl.Date, "exit_date": pl.Date, "entry_price": pl.Float64,
    "exit_price": pl.Float64, "shares": pl.Float64, "costs": pl.Float64, "pnl": pl.Float64, "closed": pl.Boolean,
}


@dataclass(frozen=True)
class BacktestSpec:
    symbol: str
    start: date
    end: date
    fast: int = 20
    slow: int = 50
    fill_model: str = "next_open"
    commission_bps: float = 0.0
    slippage_bps: float = 0.0
    initial_cash: float = 100_000.0
    source: str = DEFAULT_SOURCE
    price_basis: str = "split"

    def __post_init__(self) -> None:
        if not self.symbol:
            raise ValueError("symbol is required")
        if self.start > self.end:
            raise ValueError(f"start {self.start} is after end {self.end}")
        if self.fast < 1 or self.slow <= self.fast:
            raise ValueError(f"need 1 <= fast < slow, got fast={self.fast}, slow={self.slow}")
        if self.fill_model not in FILL_MODELS:
            raise ValueError(f"fill_model must be one of {FILL_MODELS}")
        if self.commission_bps < 0 or self.slippage_bps < 0:
            raise ValueError("costs must be >= 0")
        if self.initial_cash <= 0:
            raise ValueError("initial_cash must be > 0")
        if self.price_basis not in PRICE_BASES:
            raise ValueError(f"price_basis must be one of {PRICE_BASES}")
        if not self.source:
            raise ValueError("source is required")

    def to_dict(self) -> dict:
        d = asdict(self)
        d["start"], d["end"] = self.start.isoformat(), self.end.isoformat()
        # defaults are left out so that Sprint 03 specs (and their hashes) look exactly as before
        if self.source == DEFAULT_SOURCE:
            d.pop("source")
        if self.price_basis == "split":
            d.pop("price_basis")
        return d


@dataclass
class BacktestResult:
    spec: BacktestSpec
    equity: pl.DataFrame  # trade_date, equity, position
    trades: pl.DataFrame
    realisable: bool


def validate_bars(bars: pl.DataFrame) -> None:
    missing = [c for c in REQUIRED_COLUMNS if c not in bars.columns]
    if missing:
        raise ValueError(f"bars are missing columns: {missing}")
    if bars.height < 2:
        raise ValueError("need at least 2 bars")
    dates = bars["trade_date"]
    if dates.n_unique() != dates.len():
        raise ValueError("duplicate trade_date in bars")
    if not dates.is_sorted():
        raise ValueError("bars must be sorted by trade_date ascending")
    for c in ("open", "high", "low", "close"):
        col = bars[c]
        if col.null_count() or (col <= 0).any():
            raise ValueError(f"column {c} must be positive and non-null")


def sma_crossover(df: pl.DataFrame, fast: int, slow: int) -> pl.Series:
    """0/1 target per close: 1 when SMA(fast) > SMA(slow) (strictly), else 0 (also during warm-up)."""
    if fast < 1 or slow <= fast:
        raise ValueError(f"need 1 <= fast < slow, got fast={fast}, slow={slow}")
    f, s = indicators.sma(df, fast), indicators.sma(df, slow)
    return (
        pl.DataFrame({"f": f, "s": s})
        .select(pl.when(pl.col("f") > pl.col("s")).then(1).otherwise(0).cast(pl.Int8).alias("target"))
        .to_series()
    )


TargetFn = Callable[[pl.DataFrame, BacktestSpec], pl.Series]


def _default_targets(bars: pl.DataFrame, spec: BacktestSpec) -> pl.Series:
    return sma_crossover(bars, spec.fast, spec.slow)


def run_backtest(bars: pl.DataFrame, spec: BacktestSpec, targets: TargetFn | None = None) -> BacktestResult:
    """Simulate `spec` on `bars` (columns trade_date, open, high, low, close; sorted ascending).

    `targets` replaces the signal function (used by tests and the buy-and-hold benchmark).
    """
    validate_bars(bars)
    target = (targets or _default_targets)(bars, spec).to_list()
    dates = bars["trade_date"].to_list()
    opens, closes = bars["open"].to_list(), bars["close"].to_list()
    n = len(dates)
    slip, comm = spec.slippage_bps / 10_000.0, spec.commission_bps / 10_000.0

    cash, shares, pos = spec.initial_cash, 0.0, 0
    equity_rows: list[tuple] = []
    trades: list[dict] = []
    cur: dict | None = None  # open trade

    def buy(day: date, ref_price: float) -> None:
        nonlocal cash, shares, pos, cur
        price = ref_price * (1 + slip)
        qty = cash / (price * (1 + comm))
        commission = qty * price * comm
        cur = {"entry_date": day, "entry_price": price, "shares": qty,
               "cash_in": qty * price + commission, "costs": commission + qty * (price - ref_price)}
        cash -= qty * price + commission
        shares, pos = qty, 1

    def sell(day: date, ref_price: float) -> None:
        nonlocal cash, shares, pos, cur
        price = ref_price * (1 - slip)
        proceeds = shares * price
        commission = proceeds * comm
        cash += proceeds - commission
        cur["costs"] += commission + shares * (ref_price - price)
        trades.append({**cur, "exit_date": day, "exit_price": price, "closed": True,
                       "pnl": proceeds - commission - cur["cash_in"]})
        shares, pos, cur = 0.0, 0, None

    for i in range(n):
        if spec.fill_model == "next_open":
            if i > 0 and target[i - 1] != pos:
                (buy if target[i - 1] == 1 else sell)(dates[i], opens[i])
        else:  # same_close: act on today's signal at today's close (look-ahead)
            if target[i] != pos:
                (buy if target[i] == 1 else sell)(dates[i], closes[i])
        equity_rows.append((dates[i], cash + shares * closes[i], pos))

    if cur is not None:  # still open on the last bar: value at the last close, no exit cost
        trades.append({**cur, "exit_date": dates[-1], "exit_price": closes[-1], "closed": False,
                       "pnl": shares * closes[-1] - cur["cash_in"]})

    equity = pl.DataFrame(equity_rows, schema={"trade_date": pl.Date, "equity": pl.Float64, "position": pl.Int8},
                          orient="row")
    rows = [{"trade_no": i + 1, **{k: t[k] for k in TRADE_SCHEMA if k != "trade_no"}} for i, t in enumerate(trades)]
    trade_df = pl.DataFrame(rows, schema=TRADE_SCHEMA) if rows else pl.DataFrame(schema=TRADE_SCHEMA)
    return BacktestResult(spec, equity, trade_df, realisable=spec.fill_model == "next_open")


def buy_and_hold(bars: pl.DataFrame, spec: BacktestSpec) -> BacktestResult:
    """Benchmark: target 1 from the first bar, through the same engine path and costs."""
    ones: TargetFn = lambda b, s: pl.Series("target", [1] * b.height, dtype=pl.Int8)  # noqa: E731
    return run_backtest(bars, spec, targets=ones)


def spec_bars(conn, spec: BacktestSpec, start: date | None = None, end: date | None = None) -> pl.DataFrame:
    """Bars for a spec: its source and price basis, adjusted as of `end` (default spec.end)."""
    from .read import get_bars

    return get_bars(conn, spec.symbol, start or spec.start, end or spec.end, source=spec.source,
                    adjustment=spec.price_basis)


def backtest_from_db(conn, spec: BacktestSpec) -> tuple[pl.DataFrame, BacktestResult]:
    """Load bars (spec.source, spec.price_basis) adjusted as of spec.end and run the strategy."""
    bars = spec_bars(conn, spec)
    return bars, run_backtest(bars, spec)


def full_run(bars: pl.DataFrame, spec: BacktestSpec, rf: Sequence[float] | None = None) -> dict:
    """Strategy + benchmark with metrics. The shape used by the API and by persistence.

    `rf` (one daily risk-free return per bar, known the day before) adds `sharpe_excess` to both metric
    dicts; the default None leaves the output exactly as in Sprint 03/04. The engine's idle cash still
    earns 0, so excess Sharpe of an in-and-out rule is biased down while rates are positive."""
    res = run_backtest(bars, spec)
    bench = buy_and_hold(bars, spec)
    return {"result": res, "benchmark": bench, "metrics": summarise(res.equity, res.trades, rf),
            "benchmark_metrics": summarise(bench.equity, bench.trades, rf)}


def compare_fill_models(bars: pl.DataFrame, spec: BacktestSpec) -> dict:
    """Run the same strategy with `next_open` and `same_close` (look-ahead detector)."""
    a = run_backtest(bars, replace(spec, fill_model="next_open"))
    b = run_backtest(bars, replace(spec, fill_model="same_close"))
    ma, mb = summarise(a.equity, a.trades), summarise(b.equity, b.trades)
    return {
        "next_open": {"realisable": True, **ma},
        "same_close": {"realisable": False, **mb},
        "total_return_difference": mb["total_return"] - ma["total_return"],
        "warning": "same_close decides and trades on the same close, which is impossible in practice; "
                   "any gain over next_open is look-ahead, not skill.",
    }


def check_engine_truncation(
    spec: BacktestSpec, loader: Callable[[date], pl.DataFrame], cut_points: int = 50, seed: int = 1,
    runner: Callable[[pl.DataFrame, BacktestSpec], BacktestResult] = run_backtest, rel_tol: float = 1e-9,
    extra_cut_dates: Sequence[date] = (),
) -> list[dict]:
    """Causality test for the engine: equity and position at date t from the full run must equal
    those from a run whose data end at t. `loader(d)` returns bars adjusted as of `d`.
    Returns the list of mismatches (empty means the check passed)."""
    full_bars = loader(spec.end)
    full = runner(full_bars, spec)
    dates = full.equity["trade_date"].to_list()
    rng = random.Random(seed)
    picks = set(rng.sample(range(1, len(dates)), min(cut_points, len(dates) - 1)))
    picks |= {dates.index(d) for d in extra_cut_dates if d in dates and dates.index(d) > 0}
    eq_full = dict(zip(dates, full.equity["equity"].to_list()))
    pos_full = dict(zip(dates, full.equity["position"].to_list()))
    bad: list[dict] = []
    for idx in sorted(picks):
        t = dates[idx]
        cut = runner(loader(t), replace(spec, end=t))
        e_cut, p_cut = cut.equity["equity"][-1], cut.equity["position"][-1]
        if p_cut != pos_full[t] or abs(e_cut - eq_full[t]) > rel_tol * max(1.0, abs(eq_full[t])):
            bad.append({"date": t.isoformat(), "full_equity": eq_full[t], "truncated_equity": e_cut,
                        "full_position": pos_full[t], "truncated_position": p_cut})
    return bad


DEFAULT_GRID = (0, 1, 2, 5, 10, 20, 50)


def cost_sweep(bars: pl.DataFrame, spec: BacktestSpec, grid_bps=DEFAULT_GRID, include_commission: bool = False) -> list[dict]:
    """Rerun the strategy for each cost level (slippage bps; commission too when requested)."""
    grid = list(grid_bps)
    if not grid:
        raise ValueError("grid must not be empty")
    if any(g < 0 for g in grid):
        raise ValueError("grid values must be >= 0")
    if grid != sorted(set(grid)):
        raise ValueError("grid must be sorted ascending without duplicates")
    rows = []
    for g in grid:
        s = replace(spec, slippage_bps=float(g), commission_bps=float(g) if include_commission else spec.commission_bps)
        out = full_run(bars, s)
        m, b = out["metrics"], out["benchmark_metrics"]
        rows.append({"cost_bps": g, "total_return": m["total_return"], "sharpe": m["sharpe"], "trades": m["trades"],
                     "total_costs": m["total_costs"], "benchmark_total_return": b["total_return"]})
    return rows


def break_even(rows: list[dict], baseline: str = "zero") -> float | None:
    """Cost (bps) at which the strategy's total return falls to the baseline, by linear interpolation.

    baseline 'zero' compares with 0; 'benchmark' compares with buy-and-hold at the same cost.
    Returns 0.0 if the strategy does not beat the baseline even at the first grid value and None if it
    still beats it at the last grid value.
    """
    if baseline not in ("zero", "benchmark"):
        raise ValueError("baseline must be 'zero' or 'benchmark'")
    excess = [(r["cost_bps"], r["total_return"] - (r["benchmark_total_return"] if baseline == "benchmark" else 0.0))
              for r in rows]
    if not excess:
        raise ValueError("no rows")
    if excess[0][1] <= 0:
        return 0.0
    for (c0, e0), (c1, e1) in zip(excess, excess[1:]):
        if e1 <= 0 < e0:
            return c0 + (c1 - c0) * e0 / (e0 - e1)
    return None
