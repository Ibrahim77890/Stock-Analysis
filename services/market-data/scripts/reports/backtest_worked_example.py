"""Run the Sprint 03 worked example on the real database and write docs/02-domain/backtest-worked-example.md.

All numbers in the generated page come from this run (nothing is typed by hand). It also saves the two
base runs to research.* (idempotent) so their hashes can be reproduced with `POST /backtests/{id}/reproduce`.
Usage: uv run python scripts/reports/backtest_worked_example.py
"""

import platform
import time
from dataclasses import replace
from datetime import date, datetime, timezone

import psycopg

from market_data.core import config
from market_data.backtesting.backtest import BacktestSpec, break_even, compare_fill_models, cost_sweep, full_run, run_backtest
from market_data.backtesting.luck import shuffle_test
from market_data.market.read import get_bars
from market_data.backtesting.research import config_hash, dataset_fingerprint, reproduce_run, result_hash, save_run

END = date(2025, 12, 31)
CASES = [("AAPL", date(2020, 7, 27)), ("SPY", date(2018, 11, 1))]  # first stored bar of each symbol


def pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def num(x, d=2):
    return "n/a" if x is None else f"{x:.{d}f}"


def main() -> None:
    out = [f"# Backtest worked example (generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC)\n",
           "Produced by `scripts/reports/backtest_worked_example.py` on this machine from the loaded data; every number below is "
           "copied from that run. It demonstrates mechanics and caveats. **It is not evidence of a profitable strategy.**\n",
           f"Environment: {platform.platform()}, Python {platform.python_version()}. Engine version 1. Prices are "
           "split-adjusted as of the last date; dividends are not included in returns; risk-free rate 0; "
           "universe is survivorship-biased (see ADR 0009 and the data dictionary).\n"]
    with psycopg.connect(config.database_url()) as conn:
        for symbol, start in CASES:
            bars = get_bars(conn, symbol, start, END, adjustment="split")
            base = BacktestSpec(symbol=symbol, start=start, end=END, fast=20, slow=50)
            out.append(f"## {symbol} (SMA 20/50, {bars.height} bars, {bars['trade_date'][0]} to {bars['trade_date'][-1]})\n")
            rows = []
            for label, s in (("zero cost", base), ("5 bps slippage, 1 bp commission", replace(base, slippage_bps=5, commission_bps=1))):
                o = full_run(bars, s)
                m, b = o["metrics"], o["benchmark_metrics"]
                rows.append(f"| {label} | {pct(m['total_return'])} | {pct(m['cagr'])} | {num(m['sharpe'])} | {pct(m['max_drawdown'])} | "
                            f"{m['trades']} | {pct(m['exposure'])} | {pct(b['total_return'])} | {num(b['sharpe'])} | {pct(b['max_drawdown'])} |")
            out += ["| Setting | Strategy return | CAGR | Sharpe | Max drawdown | Trades | Exposure | Buy-and-hold return | B&H Sharpe | B&H max drawdown |",
                    "|---|---|---|---|---|---|---|---|---|---|", *rows, ""]
            cmp = compare_fill_models(bars, base)
            out += ["**Look-ahead detector** (same strategy, zero cost):\n",
                    "| Fill model | Realisable | Total return | Sharpe |", "|---|---|---|---|",
                    f"| next_open | yes | {pct(cmp['next_open']['total_return'])} | {num(cmp['next_open']['sharpe'])} |",
                    f"| same_close | **no** | {pct(cmp['same_close']['total_return'])} | {num(cmp['same_close']['sharpe'])} |",
                    f"\nDifference (same_close - next_open): {pct(cmp['total_return_difference'])}. "
                    "Whatever its sign here, the same_close number is not obtainable in practice.\n"]
            for fast, slow in ((20, 50), (2, 3)):
                s = replace(base, fast=fast, slow=slow)
                sw = cost_sweep(bars, s)
                out += [f"**Cost sweep, SMA {fast}/{slow}** (slippage bps per fill):\n", "| Cost (bps) | Strategy return | Trades | Total costs | Buy-and-hold return |",
                        "|---|---|---|---|---|",
                        *[f"| {r['cost_bps']} | {pct(r['total_return'])} | {r['trades']} | {num(r['total_costs'], 0)} | {pct(r['benchmark_total_return'])} |" for r in sw],
                        f"\nBreak-even vs 0%: {break_even(sw, 'zero')} bps; vs buy-and-hold: {break_even(sw, 'benchmark')} bps "
                        "(`None` = still above at 50 bps; `0.0` = not above even at 0 bps).\n"]
            for method in ("block_bootstrap", "gbm"):
                t0 = time.perf_counter()
                sh = shuffle_test(bars, base, method=method, n_paths=200, block_length=20, seed=1)
                dt = time.perf_counter() - t0
                tr, sp = sh["total_return"], sh["sharpe"]
                out += [f"**Luck control, {method}** (200 paths, seed 1, {dt:.1f} s): real total return {pct(tr['real'])} is at percentile "
                        f"{pct(tr['percentile_rank'])} of the paths; {pct(tr['fraction_ge'])} of paths did at least as well. "
                        f"Path return quantiles p5/p50/p95: {pct(tr['quantiles']['p5'])} / {pct(tr['quantiles']['p50'])} / {pct(tr['quantiles']['p95'])}. "
                        f"Real Sharpe {num(sp['real'])}; fraction of paths with Sharpe >= real: {pct(sp['fraction_ge'])}.\n"]
            # timing (informational)
            t0 = time.perf_counter()
            run_backtest(bars, base)
            one = time.perf_counter() - t0
            t0 = time.perf_counter()
            for _ in range(100):
                run_backtest(bars, base)
            hundred = time.perf_counter() - t0
            out.append(f"Timing (informational, this machine): one run {one * 1000:.0f} ms, 100 runs {hundred:.1f} s on {bars.height} bars.\n")
            # persist the base run with 5 bps slippage for the reproduction demo
            s_saved = replace(base, slippage_bps=5, commission_bps=1)
            o = full_run(bars, s_saved)
            saved = save_run(conn, s_saved, bars, o)
            rep = reproduce_run(conn, saved["run_id"])
            out.append(f"Saved run (`research.backtest_run`): run_id {saved['run_id']}, config_hash `{saved['config_hash']}`, result_hash "
                       f"`{saved['result_hash']}`, dataset_fingerprint `{dataset_fingerprint(bars)}`; reproduce status: **{rep['status']}**.\n")
    path = config.DOCS_DIR / "02-domain" / "backtest-worked-example.md"
    path.write_text("\n".join(out), encoding="utf-8")
    print(path)


if __name__ == "__main__":
    main()
