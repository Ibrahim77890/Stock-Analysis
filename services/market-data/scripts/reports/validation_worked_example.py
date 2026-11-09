"""Run the Sprint 04 validation story on the real database and write docs/02-domain/validation-worked-example.md.

Every number in the page comes from this run. It creates studies in research.study / research.trial (the
registry counts attempts, so re-running adds new studies; results do not depend on earlier studies).
Usage: uv run python scripts/reports/validation_worked_example.py [output.md]
"""

import platform
import sys
import time
from pathlib import Path
from datetime import date, datetime, timezone

import psycopg

from market_data.core import config
from market_data.validation import regimes, scan
from market_data.backtesting.backtest import BacktestSpec, run_backtest
from market_data.market.read import get_bars
from market_data.validation.sharpe_stats import overfitting_meter
from market_data.validation.protocol import create_study, evaluate_split, final_holdout_evaluation, make_grid, walk_forward

END = date(2025, 12, 31)
CASES = [("SPY", date(2020, 7, 27)), ("AAPL", date(2020, 7, 27))]  # contiguous window (see the window audit)
GRID = make_grid([3, 5, 10, 20, 30], [20, 30, 50, 100, 150])


def pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def num(x, d=2):
    return "n/a" if x is None else f"{x:.{d}f}"


def main() -> None:
    out = [f"# Validation worked example (generated {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC)\n",
           "Produced by `scripts/reports/validation_worked_example.py` from the loaded data; every number is copied from that run. "
           "It shows mechanics and caveats and is **not evidence of a profitable strategy**. Sharpe values are annualised; "
           "costs are 1 bp commission + 2 bps slippage per fill; prices are split-adjusted; dividends are not in returns; "
           f"the universe is survivorship-biased. Environment: {platform.platform()}, Python {platform.python_version()}. "
           f"Grid: fast in 3, 5, 10, 20, 30 and slow in 20, 30, 50, 100, 150 with fast < slow = {len(GRID)} pairs.\n"]
    with psycopg.connect(config.database_url()) as conn:
        for symbol, start in CASES:
            bars = get_bars(conn, symbol, start, END, adjustment="split")
            base = BacktestSpec(symbol=symbol, start=start, end=END, fast=2, slow=3, commission_bps=1, slippage_bps=2)
            out.append(f"## {symbol} ({bars.height} bars, {bars['trade_date'][0]} to {bars['trade_date'][-1]})\n")

            # 1) split with a holdout
            sid = create_study(conn, f"worked-example split {symbol}", symbol)
            sp = evaluate_split(bars, base, GRID, train_bars=1000, embargo=5, holdout_bars=200, conn=conn, study_id=sid)
            sel = sp["selected"]
            out += [f"### Train/test split (train 1,000 bars, embargo 5, holdout 200 bars) - {sp['trials']} trials\n",
                    f"Selected on the training bars only: **{sel['fast']}/{sel['slow']}**.\n",
                    "| Block | Range | Total return | Sharpe | Trades |", "|---|---|---|---|---|",
                    f"| In-sample (train) | {sp['train_range'][0]} to {sp['train_range'][1]} | {pct(sp['in_sample']['total_return'])} | {num(sp['in_sample']['sharpe'])} | {sp['in_sample']['trades']} |",
                    f"| Out-of-sample (test) | {sp['test_range'][0]} to {sp['test_range'][1]} | {pct(sp['out_of_sample']['total_return'])} | {num(sp['out_of_sample']['sharpe'])} | {sp['out_of_sample']['trades']} |",
                    f"\nDecay (in-sample minus out-of-sample Sharpe): **{num(sp['decay_sharpe'])}**. Only {sp['out_of_sample']['trades']} test trades: noisy.\n"]
            ho = final_holdout_evaluation(conn, sid, bars, base, sel["fast"], sel["slow"], 200)
            out.append(f"Holdout (one use, last 200 bars, {ho['window'][0]} to {ho['window'][1]}): return {pct(ho['out_of_sample']['total_return'])}, "
                       f"Sharpe {num(ho['out_of_sample']['sharpe'])}, trades {ho['out_of_sample']['trades']}. A second call is refused (HTTP 409 in Swagger).\n")
            m = overfitting_meter(conn, sid)
            out += ["**Overfitting meter** for this search:\n", "| Trials N | Best train Sharpe | Expected best under no skill | DSR of the best | PSR(0) of the best |", "|---|---|---|---|---|",
                    f"| {m['trials']} | {num(m['best_sharpe_annualised'])} | {num(m['expected_max_sharpe_annualised'])} | {num(m['dsr'], 3)} | {num(m['psr_vs_zero'], 3)} |",
                    "\nDSR is a warning light: trials are treated as independent and the registry cannot count ideas tried elsewhere.\n"]

            # 2) walk-forward
            wid = create_study(conn, f"worked-example walk-forward {symbol}", symbol)
            wf = walk_forward(bars, base, GRID, train=500, test=100, embargo=5, conn=conn, study_id=wid)
            out += [f"### Walk-forward (train 500, test 100, embargo 5) - {wf['fold_count']} folds, {wf['trials']} trials\n",
                    "| Fold | Test range | Selected | IS Sharpe | OOS Sharpe | OOS return | OOS trades |", "|---|---|---|---|---|---|---|"]
            for f in wf["folds"]:
                out.append(f"| {f['fold']} | {f['test_range'][0]} to {f['test_range'][1]} | {f['selected']['fast']}/{f['selected']['slow']} | "
                           f"{num(f['is_sharpe'])} | {num(f['oos_sharpe'])} | {pct(f['oos_return'])} | {f['oos_trades']} |")
            sm = wf["stitched_metrics"]
            out.append(f"\nStitched out-of-sample curve: return {pct(sm['total_return'])}, Sharpe {num(sm['sharpe'])}, max drawdown {pct(sm['max_drawdown'])}, "
                       f"{sm['trades']} trades; the selected pair changed {wf['parameter_changes']} times between folds.\n")

            # 3) regimes (fixed 20/50)
            spec = BacktestSpec(symbol=symbol, start=start, end=END, fast=20, slow=50, commission_bps=1, slippage_bps=2)
            res = run_backtest(bars, spec)
            for by in ("year", "vol"):
                rg = regimes.regime_breakdown(res, bars, by)
                out += [f"### Regimes by {'calendar year' if by == 'year' else 'trailing volatility'} (SMA 20/50)\n",
                        "| Group | Days | Share in market | Return | Trades started |", "|---|---|---|---|---|",
                        *[f"| {g['label']} | {g['days']} | {pct(g['share_in_market'])} | {pct(g['return'])} | {g['trades_started']} |" for g in rg["groups"]],
                        f"\nProduct of group growth factors {rg['product_of_group_growth']:.6f} = total growth {rg['total_growth']:.6f}. {rg['note']}\n"]

        # 4) universe scan + best of N
        spec = BacktestSpec(symbol="UNIVERSE", start=date(2020, 7, 27), end=END, fast=20, slow=50, commission_bps=1, slippage_bps=2)
        t0 = time.perf_counter()
        sc = scan.universe_scan(conn, spec)
        t1 = time.perf_counter()
        bn = scan.best_of_n_control(conn, spec, replicates=100, seed=1)
        t2 = time.perf_counter()
        q = sc["sharpe_quantiles"]
        out += [f"## Universe scan, SMA 20/50 on {sc['n']} symbols ({len(sc['skipped'])} skipped)\n",
                f"Sharpe quantiles p5/p25/p50/p75/p95: {num(q['p5'])} / {num(q['p25'])} / {num(q['p50'])} / {num(q['p75'])} / {num(q['p95'])}; best {num(sc['best_sharpe'])}.\n",
                "| Best 5 | Sharpe | Return | Trades |", "|---|---|---|---|",
                *[f"| {r['symbol']} | {num(r['sharpe'])} | {pct(r['total_return'])} | {r['trades']} |" for r in sc["rows"][:5]],
                "\n| Worst 5 | Sharpe | Return | Trades |", "|---|---|---|---|",
                *[f"| {r['symbol']} | {num(r['sharpe'])} | {pct(r['total_return'])} | {r['trades']} |" for r in sc["rows"][-5:]],
                f"\n**Best-of-{bn['n_symbols']} control** (100 replicates of {bn['n_symbols']} random-walk symbols, seed 1): the real best Sharpe {num(bn['real_best_sharpe'])} "
                f"is at percentile {pct(bn['percentile_rank'])} of the simulated maxima ({pct(bn['fraction_ge'])} of replicates had a maximum at least as large; "
                f"p5/p50/p95 of simulated maxima: {num(bn['control_max_sharpe_quantiles']['p5'])} / {num(bn['control_max_sharpe_quantiles']['p50'])} / {num(bn['control_max_sharpe_quantiles']['p95'])}).\n",
                f"Caveat: {sc['caveat']}\n",
                f"Timing (informational, this machine): scan {t1 - t0:.1f} s, 100 replicates x {bn['n_symbols']} symbols {t2 - t1:.1f} s.\n"]
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else config.DOCS_DIR / "02-domain" / "validation-worked-example.md"
    path.write_text("\n".join(out), encoding="utf-8")
    print(path)


if __name__ == "__main__":
    main()
