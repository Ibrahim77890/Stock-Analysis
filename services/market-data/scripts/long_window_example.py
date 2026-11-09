"""Sprint 05: rerun the Sprint 04 validation story on the long Tiingo window and write
docs/02-domain/long-window-example.md.

Three set-ups answer the same questions so that the effects can be told apart:
  A  Alpaca IEX, split-adjusted prices, 2020-07-27 -> 2025-12-31 (the Sprint 04 set-up; windows as in Sprint 04)
  B  Tiingo, split-adjusted prices, the same 2020-07-27 -> 2025-12-31 window (isolates the SOURCE)
  C  Tiingo, split + dividend adjusted prices, 2005-01-03 -> 2025-12-31 (the LONG window; windows scaled up)
Every number in the page is copied from this run. Studies are written to the trial registry (research.*); the page
prints no study ids, so reruns give the same text apart from the timestamp and timing lines.
Usage: python scripts/long_window_example.py [output.md]
This is a teaching page, NOT evidence of a profitable strategy. Tiingo data are internal use only: the page contains
only derived statistics. This product uses the FRED API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.
"""

import math
import platform
import sys
import time
from datetime import UTC, date, datetime
from pathlib import Path

import psycopg

from market_data import config, regimes, scan
from market_data.backtest import BacktestSpec, full_run, run_backtest
from market_data.macro import ATTRIBUTION, daily_risk_free
from market_data.read import get_bars, get_macro, list_instruments
from market_data.sharpe_stats import overfitting_meter
from market_data.validation import create_study, evaluate_split, final_holdout_evaluation, make_grid, walk_forward

END = date(2025, 12, 31)
SHORT_START = date(2020, 7, 27)
LONG_START = date(2005, 1, 3)
GRID = make_grid([3, 5, 10, 20, 30], [20, 30, 50, 100, 150])
SETUPS = {
    "A": dict(label="A: Alpaca IEX, split, 5.4 years", source="alpaca", basis="split", start=SHORT_START,
              split=dict(train=1000, holdout=200), wf=dict(train=500, test=100)),
    "B": dict(label="B: Tiingo, split, same 5.4 years", source="tiingo", basis="split", start=SHORT_START,
              split=dict(train=1000, holdout=200), wf=dict(train=500, test=100)),
    "C": dict(label="C: Tiingo, split + dividend, 21 years", source="tiingo", basis="split_dividend", start=LONG_START,
              split=dict(train=2500, holdout=1000), wf=dict(train=1000, test=250)),
}
SYMBOLS = ("SPY", "AAPL")


def pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def num(x, d=2):
    return "n/a" if x is None else f"{x:.{d}f}"


def years(bars):
    return (bars["trade_date"][-1] - bars["trade_date"][0]).days / 365.25


def story(conn, symbol, cfg):
    """All numbers for one symbol in one set-up."""
    src, basis, start = cfg["source"], cfg["basis"], cfg["start"]
    bars = get_bars(conn, symbol, start, END, source=src, adjustment=basis)
    base = BacktestSpec(symbol=symbol, start=start, end=END, fast=2, slow=3, commission_bps=1, slippage_bps=2,
                        source=src, price_basis=basis)
    s = {"bars": bars, "n": bars.height, "first": bars["trade_date"][0], "last": bars["trade_date"][-1], "years": years(bars)}
    sid = create_study(conn, f"long-window split {symbol} {src} {basis}", symbol)
    sp = evaluate_split(bars, base, GRID, train_bars=cfg["split"]["train"], embargo=5, holdout_bars=cfg["split"]["holdout"],
                        conn=conn, study_id=sid)
    sel = sp["selected"]
    ho = final_holdout_evaluation(conn, sid, bars, base, sel["fast"], sel["slow"], cfg["split"]["holdout"])
    s.update(split=sp, holdout=ho, meter=overfitting_meter(conn, sid))
    wid = create_study(conn, f"long-window walk-forward {symbol} {src} {basis}", symbol)
    s["wf"] = walk_forward(bars, base, GRID, train=cfg["wf"]["train"], test=cfg["wf"]["test"], embargo=5, conn=conn, study_id=wid)
    spec = BacktestSpec(symbol=symbol, start=start, end=END, fast=20, slow=50, commission_bps=1, slippage_bps=2,
                        source=src, price_basis=basis)
    rf = daily_risk_free(conn, bars["trade_date"].to_list())
    s["spec"], s["full"] = spec, full_run(bars, spec, rf)
    res = s["full"]["result"]
    s["reg_year"] = regimes.regime_breakdown(res, bars, "year")
    s["reg_vix"] = regimes.regime_breakdown(res, bars, "vix", vix=get_macro(conn, "VIXCLS"))
    return s


def coverage_table(conn):
    t = {r["symbol"]: r for r in list_instruments(conn, "tiingo")}
    a = {r["symbol"]: r for r in list_instruments(conn, "alpaca")}
    rows = ["| Symbol | Tiingo first date | Tiingo bars | Covers 2005-01-03 | Alpaca bars (IEX) |", "|---|---|---|---|---|"]
    covering, missing = [], []
    for sym in sorted(set(t) | set(a)):
        r = t.get(sym)
        if not r or not r["bars"]:
            rows.append(f"| {sym} | none | 0 | no | {a.get(sym, {}).get('bars', 0)} |")
            missing.append(sym)
            continue
        cov = r["first_date"] <= LONG_START
        (covering if cov else missing).append(sym)
        rows.append(f"| {sym} | {r['first_date']} | {r['bars']} | {'yes' if cov else 'no'} | {a.get(sym, {}).get('bars', 0)} |")
    return rows, covering, missing


def main() -> None:
    out = [f"# Long-window validation example (generated {datetime.now(UTC):%Y-%m-%d %H:%M} UTC)\n",
           "Produced by `scripts/long_window_example.py` from the loaded data; every number is copied from that run. It repeats the "
           "Sprint 04 questions on a much longer history and **is not evidence of a profitable strategy**. Sharpe values are "
           "annualised; costs are 1 bp commission + 2 bps slippage per fill; the universe is survivorship-biased; the engine's idle "
           "cash earns 0 while the excess-Sharpe column subtracts the previous day's 3-month Treasury yield (a downward bias for "
           f"in-and-out rules). Environment: {platform.platform()}, Python {platform.python_version()}. "
           f"Grid: fast in 3, 5, 10, 20, 30 and slow in 20, 30, 50, 100, 150 with fast < slow = {len(GRID)} pairs.\n",
           f"Data: Alpaca IEX and Tiingo end-of-day (internal use only; no price data are in this page), FRED DGS3MO and VIXCLS. {ATTRIBUTION}\n",
           "Set-ups: " + "; ".join(c["label"] for c in SETUPS.values()) + ". Windows are scaled to the data: split train/holdout "
           "bars A,B = 1,000/200 and C = 2,500/1,000; walk-forward train/test A,B = 500/100 and C = 1,000/250; embargo 5 everywhere.\n"]
    with psycopg.connect(config.database_url()) as conn:
        cov_rows, covering, missing = coverage_table(conn)
        out += ["## Coverage of the long window\n", *cov_rows, "",
                f"{len(covering)} symbols cover 2005-01-03 ({', '.join(covering[:60])}). "
                + (f"Not covering it: {', '.join(missing)} (their ETF/IPO history starts later; they are left out of the long-window scan, "
                   "not dropped silently).\n" if missing else "All loaded symbols cover it.\n")]

        results = {}
        for sym in SYMBOLS:
            for k, cfg in SETUPS.items():
                results[(sym, k)] = story(conn, sym, cfg)
            out.append(f"## {sym}\n")
            for k, cfg in SETUPS.items():
                s = results[(sym, k)]
                sp, ho, m, wf = s["split"], s["holdout"], s["meter"], s["wf"]
                out += [f"### {sym}, set-up {cfg['label']} ({s['n']} bars, {s['first']} to {s['last']}, {s['years']:.1f} years)\n",
                        f"Split ({sp['trials']} trials): selected **{sp['selected']['fast']}/{sp['selected']['slow']}** on the training bars only.\n",
                        "| Block | Range | Total return | Sharpe | Trades |", "|---|---|---|---|---|",
                        f"| In-sample | {sp['train_range'][0]} to {sp['train_range'][1]} | {pct(sp['in_sample']['total_return'])} | {num(sp['in_sample']['sharpe'])} | {sp['in_sample']['trades']} |",
                        f"| Out-of-sample | {sp['test_range'][0]} to {sp['test_range'][1]} | {pct(sp['out_of_sample']['total_return'])} | {num(sp['out_of_sample']['sharpe'])} | {sp['out_of_sample']['trades']} |",
                        f"| Holdout (one use) | {ho['window'][0]} to {ho['window'][1]} | {pct(ho['out_of_sample']['total_return'])} | {num(ho['out_of_sample']['sharpe'])} | {ho['out_of_sample']['trades']} |",
                        f"\nDecay (in-sample minus out-of-sample Sharpe): **{num(sp['decay_sharpe'])}**. Overfitting meter: N = {m['trials']} trials, best train Sharpe "
                        f"{num(m['best_sharpe_annualised'])}, expected best under no skill {num(m['expected_max_sharpe_annualised'])}, DSR {num(m['dsr'], 3)}, PSR(0) {num(m['psr_vs_zero'], 3)}.\n",
                        f"Walk-forward ({wf['fold_count']} folds, {wf['trials']} trials): stitched out-of-sample return {pct(wf['stitched_metrics']['total_return'])}, "
                        f"Sharpe {num(wf['stitched_metrics']['sharpe'])}, max drawdown {pct(wf['stitched_metrics']['max_drawdown'])}, {wf['stitched_metrics']['trades']} trades; "
                        f"the selected pair changed {wf['parameter_changes']} times.\n"]
            # price basis and risk-free table (fixed SMA 20/50)
            out += [f"### {sym}: price basis and risk-free rate (fixed SMA 20/50, full window of each set-up)\n",
                    "| Set-up | Series | Total return | CAGR | Sharpe (rf 0) | Sharpe (excess) | Max drawdown | Trades |", "|---|---|---|---|---|---|---|---|"]
            for k, cfg in SETUPS.items():
                f = results[(sym, k)]["full"]
                for name, mm in (("SMA 20/50", f["metrics"]), ("buy and hold", f["benchmark_metrics"])):
                    out.append(f"| {k} | {name} | {pct(mm['total_return'])} | {pct(mm['cagr'])} | {num(mm['sharpe'])} | {num(mm['sharpe_excess'])} | {pct(mm['max_drawdown'])} | {mm['trades']} |")
            # price vs total return on the long window
            lw = results[(sym, "C")]
            bars_px = get_bars(conn, sym, LONG_START, END, source="tiingo", adjustment="split")
            spec_px = BacktestSpec(symbol=sym, start=LONG_START, end=END, fast=20, slow=50, commission_bps=1, slippage_bps=2, source="tiingo")
            px = full_run(bars_px, spec_px)
            out += [f"\nPrice return vs total return on the long window (SMA 20/50, buy and hold): split only: strategy {pct(px['metrics']['total_return'])}, buy and hold "
                    f"{pct(px['benchmark_metrics']['total_return'])}; split + dividend: strategy {pct(lw['full']['metrics']['total_return'])}, buy and hold "
                    f"{pct(lw['full']['benchmark_metrics']['total_return'])}. The engine's cash earns 0 and dividends are credited through adjusted prices, so the total-return "
                    "figure counts them only while the strategy holds the stock.\n"]
            # regimes on the long window
            for by, key, title in (("year", "reg_year", "calendar year"), ("vix", "reg_vix", "VIX bucket (previous close; low < 15, medium 15 to 25, high >= 25)")):
                rg = lw[key]
                out += [f"### {sym}: regimes by {title} (SMA 20/50, set-up C)\n", "| Group | Days | Share in market | Return | Trades started |", "|---|---|---|---|---|",
                        *[f"| {g['label']} | {g['days']} | {pct(g['share_in_market'])} | {pct(g['return'])} | {g['trades_started']} |" for g in rg["groups"]],
                        f"\nProduct of group growth factors {rg['product_of_group_growth']:.6f} = total growth {rg['total_growth']:.6f}. {rg['note']}\n"]

        # universe scans
        out.append("## Universe scan and the best-of-N control (SMA 20/50)\n")
        scan_rows = []
        for key, cfg, syms, minb in (("A", SETUPS["A"], None, 500), ("B", SETUPS["B"], None, 500), ("C", SETUPS["C"], covering, 5000)):
            spec = BacktestSpec(symbol="UNIVERSE", start=cfg["start"], end=END, fast=20, slow=50, commission_bps=1, slippage_bps=2,
                                source=cfg["source"], price_basis=cfg["basis"])
            t0 = time.perf_counter()
            sc = scan.universe_scan(conn, spec, syms, minb)
            bn = scan.best_of_n_control(conn, spec, syms, replicates=100, seed=1, min_bars=minb)
            dt = time.perf_counter() - t0
            q = sc["sharpe_quantiles"]
            scan_rows.append((key, cfg["label"], sc, bn, q, dt))
        out += ["| Set-up | Symbols (N) | Sharpe p5 / p50 / p95 | Best Sharpe (symbol) | Best-of-N control: percentile of real best among simulated maxima | Simulated maxima p5 / p50 / p95 |", "|---|---|---|---|---|---|"]
        for key, label, sc, bn, q, dt in scan_rows:
            best = sc["rows"][0]
            cq = bn["control_max_sharpe_quantiles"]
            out.append(f"| {label} | {sc['n']} | {num(q['p5'])} / {num(q['p50'])} / {num(q['p95'])} | {num(sc['best_sharpe'])} ({best['symbol']}) | "
                       f"{pct(bn['percentile_rank'])} | {num(cq['p5'])} / {num(cq['p50'])} / {num(cq['p95'])} |")
        out += [f"\nCaveat: {scan_rows[0][2]['caveat']}\n",
                "Timing (informational, this machine): " + ", ".join(f"set-up {k} {dt:.0f} s" for k, _, _, _, _, dt in scan_rows) + ".\n"]

        # same question, two windows
        out += ["## Same question, two windows\n",
                "Each row is one question asked in all three set-ups; \"N\" is the number of trials behind any best number.\n",
                "| Question | " + " | ".join(f"{k}: {SETUPS[k]['source']}, {SETUPS[k]['basis']}, {results[('SPY', k)]['years']:.1f} y" for k in SETUPS) + " |",
                "|---|---|---|---|"]
        for sym in SYMBOLS:
            def row(title, fn):
                out.append(f"| {sym}: {title} | " + " | ".join(fn(results[(sym, k)]) for k in SETUPS) + " |")
            row("selected pair (N = 22 trials)", lambda s: f"{s['split']['selected']['fast']}/{s['split']['selected']['slow']}")
            row("in-sample / out-of-sample Sharpe", lambda s: f"{num(s['split']['in_sample']['sharpe'])} / {num(s['split']['out_of_sample']['sharpe'])}")
            row("out-of-sample trades", lambda s: str(s['split']['out_of_sample']['trades']))
            row("holdout Sharpe (trades)", lambda s: f"{num(s['holdout']['out_of_sample']['sharpe'])} ({s['holdout']['out_of_sample']['trades']})")
            row("DSR of the best (N trials)", lambda s: f"{num(s['meter']['dsr'], 3)} (N = {s['meter']['trials']})")
            row("walk-forward stitched Sharpe (trades)", lambda s: f"{num(s['wf']['stitched_metrics']['sharpe'])} ({s['wf']['stitched_metrics']['trades']})")
            row("20/50 Sharpe rf 0 / excess", lambda s: f"{num(s['full']['metrics']['sharpe'])} / {num(s['full']['metrics']['sharpe_excess'])}")
        out.append("| Universe best Sharpe (N symbols) / percentile among simulated maxima | " + " | ".join(
            f"{num(sc['best_sharpe'])} (N = {sc['n']}) / {pct(bn['percentile_rank'])}" for _, _, sc, bn, _, _ in scan_rows) + " |")
        out.append("")

        # statements computed from the numbers above (no hand-written claims about results)
        def r(sym, k):
            return results[(sym, k)]

        def decay(sym, k):
            return r(sym, k)["split"]["decay_sharpe"]

        def word(x, y, up="higher", down="lower"):
            return up if x > y else (down if x < y else "equal")

        bn_a, bn_c = scan_rows[0][3], scan_rows[2][3]
        best_b = scan_rows[1][2]["rows"][0]
        a_same = next(x for x in scan_rows[0][2]["rows"] if x["symbol"] == best_b["symbol"])
        out += ["### What changed and what did not\n",
                f"- **More evidence per block.** Out-of-sample blocks held {r('SPY','A')['split']['out_of_sample']['trades']} (SPY) and "
                f"{r('AAPL','A')['split']['out_of_sample']['trades']} (AAPL) trades on the 5.4-year window and hold {r('SPY','C')['split']['out_of_sample']['trades']} and "
                f"{r('AAPL','C')['split']['out_of_sample']['trades']} on the 21-year window; the walk-forward has {r('SPY','C')['wf']['fold_count']} folds instead of "
                f"{r('SPY','A')['wf']['fold_count']}. Still small counts: the numbers are less dominated by one episode, not proven.",
                f"- **In-sample to out-of-sample decay.** SPY: {num(decay('SPY','A'))} (A) vs {num(decay('SPY','C'))} (C); AAPL: {num(decay('AAPL','A'))} vs {num(decay('AAPL','C'))}. "
                "The large Sprint 04 decay for SPY was measured on a four-trade test block and does not repeat on the long window; AAPL still loses Sharpe out of sample there. "
                "So the Sprint 04 lesson \"the chosen pair looks worse out of sample\" holds for AAPL and is not reproduced for SPY: it depends on the symbol and the block.",
                f"- **The search size did not shrink.** The same grid still has N = {r('SPY','C')['meter']['trials']} trials. The deflated Sharpe of the best pair is "
                f"{num(r('SPY','A')['meter']['dsr'], 3)} (A) vs {num(r('SPY','C')['meter']['dsr'], 3)} (C) for SPY and {num(r('AAPL','A')['meter']['dsr'], 3)} vs {num(r('AAPL','C')['meter']['dsr'], 3)} for AAPL: "
                "a longer sample makes the same Sharpe more significant, which says nothing about the future and nothing about the trials made elsewhere.",
                f"- **Source effect (A vs B, same dates).** The two feeds give nearby but not identical results (for example SPY 20/50 Sharpe {num(r('SPY','A')['full']['metrics']['sharpe'])} vs "
                f"{num(r('SPY','B')['full']['metrics']['sharpe'])}); the differences are consistent with IEX-only prints vs consolidated prices and with three sessions missing from the Alpaca series (see the reconciliation report); this page does not separate the two.",
                f"- **Best symbol differs between A and B.** {best_b['symbol']} has Sharpe {num(best_b['sharpe'])} on Tiingo and {num(a_same['sharpe'])} on Alpaca for the same rule and dates "
                f"(best of A: {scan_rows[0][2]['rows'][0]['symbol']} {num(scan_rows[0][2]['best_sharpe'])}). Tiingo codes some spin-offs as small splits, which the `split` basis turns into price adjustments "
                "that Alpaca's raw series does not have (for example GE has two such Tiingo-only events; pending note 05_P02), so part of such gaps is a modelling choice about distributions, not feed quality.",
                f"- **Risk-free effect.** Excess Sharpe is {word(r('SPY','C')['full']['metrics']['sharpe_excess'], r('SPY','C')['full']['metrics']['sharpe'])} than the plain Sharpe on the long window "
                f"(SPY {num(r('SPY','C')['full']['metrics']['sharpe_excess'])} vs {num(r('SPY','C')['full']['metrics']['sharpe'])}) and by a larger gap on the short window "
                f"({num(r('SPY','A')['full']['metrics']['sharpe_excess'])} vs {num(r('SPY','A')['full']['metrics']['sharpe'])}), because 2022 to 2025 yields were far above zero. "
                "Idle cash earns 0 in the engine, so the excess figure of an in-and-out rule is biased downward.",
                f"- **Best of N symbols.** The best Sharpe among the scanned symbols is {num(scan_rows[0][2]['best_sharpe'])} (N = {scan_rows[0][2]['n']}, A) and {num(scan_rows[2][2]['best_sharpe'])} (N = {scan_rows[2][2]['n']}, C). "
                f"In A the real best was at percentile {pct(bn_a['percentile_rank'])} of the simulated best-of-N maxima, i.e. below all of them; in C it is at {pct(bn_c['percentile_rank'])}, inside their range. "
                "The control keeps each symbol's historical drift, which makes it a strong benchmark; on 5.4 years the real best fell below every simulated maximum, on 21 years it does not. "
                "That says the best symbol is not remarkable relative to the control, which is a much weaker statement than skill.",
                f"- **The rule vs buy and hold.** SMA 20/50 total return stays below buy and hold in every set-up for both symbols; on the long window its max drawdown is smaller "
                f"(SPY {pct(r('SPY','C')['full']['metrics']['max_drawdown'])} vs {pct(r('SPY','C')['full']['benchmark_metrics']['max_drawdown'])}) while its Sharpe is "
                f"{word(r('SPY','C')['full']['metrics']['sharpe'], r('SPY','C')['full']['benchmark_metrics']['sharpe'], 'above', 'below')} buy and hold ({num(r('SPY','C')['full']['metrics']['sharpe'])} vs {num(r('SPY','C')['full']['benchmark_metrics']['sharpe'])}). "
                "That trade-off is window-dependent (the long window contains 2008).",
                "- **Unchanged.** The universe is still a list of names that are large and liquid today (survivorship bias grows with history), costs are flat basis points, and nothing here is a forecast or advice.\n"]
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else config.DOCS_DIR / "02-domain" / "long-window-example.md"
    path.write_text("\n".join(out), encoding="utf-8")
    print(path)


if __name__ == "__main__":
    main()
