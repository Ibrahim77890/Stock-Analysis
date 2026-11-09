"""Task 05_06: price return vs total return table (split vs split_dividend), written between markers in
docs/02-domain/backtest.md.  Usage: python scripts/reports/price_basis_table.py

Rows: AAPL and SPY, windows Alpaca (2020-07-27 to 2025-12-31, IEX) and Tiingo (2005-01-03 to 2025-12-31 and the same
5.4-year window), SMA 20/50 and buy and hold, 1 bp commission + 2 bps slippage. Not evidence of a profitable strategy."""

from datetime import date
from pathlib import Path

import psycopg

from market_data.core import config
from market_data.backtesting.backtest import BacktestSpec, backtest_from_db, buy_and_hold

END = date(2025, 12, 31)
CASES = [("Alpaca IEX, 5.4 y", "alpaca", date(2020, 7, 27)), ("Tiingo, same 5.4 y", "tiingo", date(2020, 7, 27)),
         ("Tiingo, 21 y", "tiingo", date(2005, 1, 3))]
START, STOP = "<!-- price-basis-table:start -->", "<!-- price-basis-table:end -->"


def pct(x):
    return f"{x * 100:.1f}%"


def main() -> None:
    from market_data.backtesting.metrics import cagr, sharpe

    rows = ["| Symbol | Data | Basis | SMA 20/50 return | SMA 20/50 CAGR | SMA 20/50 Sharpe | Buy-and-hold return | B&H CAGR | B&H Sharpe |",
            "|---|---|---|---|---|---|---|---|---|"]
    with psycopg.connect(config.database_url()) as conn:
        for sym in ("AAPL", "SPY"):
            for label, source, start in CASES:
                for basis in ("split", "split_dividend"):
                    spec = BacktestSpec(symbol=sym, start=start, end=END, fast=20, slow=50, commission_bps=1, slippage_bps=2,
                                        source=source, price_basis=basis)
                    bars, res = backtest_from_db(conn, spec)
                    bh = buy_and_hold(bars, spec)
                    e, b = res.equity, bh.equity
                    rows.append(f"| {sym} | {label} | {basis} | {pct(e['equity'][-1] / e['equity'][0] - 1)} | {pct(cagr(e))} | "
                                f"{sharpe(e):.2f} | {pct(b['equity'][-1] / b['equity'][0] - 1)} | {pct(cagr(b))} | {sharpe(b):.2f} |")
    block = "\n".join([START, *rows, "", STOP])
    path = config.DOCS_DIR / "02-domain" / "backtest.md"
    text = path.read_text(encoding="utf-8")
    if START in text:
        a, b = text.index(START), text.index(STOP) + len(STOP)
        text = text[:a] + block + text[b:]
    else:
        text = text.rstrip() + "\n\n## Price basis comparison (Sprint 05)\n\n" + block + "\n"
    path.write_text(text, encoding="utf-8")
    print("\n".join(rows))


if __name__ == "__main__":
    main()
