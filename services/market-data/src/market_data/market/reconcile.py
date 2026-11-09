"""Cross-source reconciliation: Alpaca (IEX) vs Tiingo (task 05_04).

Reads only through `read.py`. Never repairs or deletes data: it classifies and reports.
Tolerances are fixed in ADR 0013, Appendix A (a test parses the ADR and compares).

relative difference of a price = |a - b| / a   (a = first source; 100.00 vs 100.05 -> 5 bps)
volume ratio = a_volume / b_volume              (reported, never flagged: IEX is one venue, Tiingo is all venues)
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import polars as pl
import psycopg

from market_data.core import config
from market_data.market.read import get_actions, get_bars, list_instruments

CLOSE_MISMATCH = 0.01     # > 1.0 % (100 bps): mismatch
CLOSE_NOTICE = 0.0025     # > 0.25 % (25 bps) up to the mismatch limit: notice
ACTION_TOLERANCE = 0.005  # split ratio or cash amount within 0.5 % relative
MAX_LISTED = 20
RECON_START = date(2020, 7, 27)   # contiguous window of the Alpaca data (Sprint 04 audit)
RECON_END = date.fromisoformat(config.DEFAULT_END)
PRICE_FIELDS = ("open", "high", "low", "close")
QUANTILES = (0.5, 0.9, 0.99)


def _q(s: pl.Series, qs=QUANTILES) -> dict:
    if s.len() == 0:
        return {**{f"p{int(q * 100)}": None for q in qs}, "max": None}
    return {**{f"p{int(q * 100)}": float(s.quantile(q, interpolation="linear")) for q in qs}, "max": float(s.max())}


def reconcile_bars(conn: psycopg.Connection, symbol: str, a: str = "alpaca", b: str = "tiingo",
                   start: date | None = RECON_START, end: date | None = RECON_END) -> dict:
    """Compare raw daily bars of two sources for one symbol over [start, end]."""
    lo, hi = start or date(1900, 1, 1), end or date(2100, 1, 1)
    da = get_bars(conn, symbol, lo, hi, source=a)
    db = get_bars(conn, symbol, lo, hi, source=b)
    return reconcile_frames(da, db, symbol=symbol, a=a, b=b, window=(lo, hi))


def reconcile_frames(da: pl.DataFrame, db: pl.DataFrame, *, symbol: str = "", a: str = "A", b: str = "B",
                     window: tuple[date, date] | None = None) -> dict:
    """Pure core of reconcile_bars (frames with trade_date, open, high, low, close, volume)."""
    ra = da.rename({c: f"{c}_a" for c in da.columns if c != "trade_date"})
    rb = db.rename({c: f"{c}_b" for c in db.columns if c != "trade_date"})
    j = ra.join(rb, on="trade_date", how="inner").sort("trade_date")
    only_a = ra.join(rb, on="trade_date", how="anti")["trade_date"].sort().to_list()
    only_b = rb.join(ra, on="trade_date", how="anti")["trade_date"].sort().to_list()
    out = {"symbol": symbol, "a": a, "b": b,
           "window": [window[0].isoformat(), window[1].isoformat()] if window else None,
           "dates_a": da.height, "dates_b": db.height, "matched": j.height,
           "only_in_a": len(only_a), "only_in_b": len(only_b),
           "only_in_a_examples": [d.isoformat() for d in only_a[:10]],
           "only_in_b_examples": [d.isoformat() for d in only_b[:10]]}
    if out["matched"] + out["only_in_a"] != out["dates_a"] or out["matched"] + out["only_in_b"] != out["dates_b"]:
        raise ValueError("reconciliation counts do not add up")
    diffs = {}
    for f in PRICE_FIELDS:
        diffs[f] = ((pl.col(f"{f}_a") - pl.col(f"{f}_b")).abs() / pl.col(f"{f}_a")).alias(f"d_{f}")
    j = j.with_columns(list(diffs.values()))
    out["price_abs_rel_diff"] = {f: _q(j[f"d_{f}"]) for f in PRICE_FIELDS}
    vr = j.filter(pl.col("volume_b") > 0).select((pl.col("volume_a") / pl.col("volume_b")).alias("r"))["r"]
    out["volume_ratio_a_over_b"] = {"p1": float(vr.quantile(0.01)) if vr.len() else None,
                                    "p50": float(vr.quantile(0.5)) if vr.len() else None,
                                    "p99": float(vr.quantile(0.99)) if vr.len() else None,
                                    "flagged": 0, "note": "reported only; never flagged"}
    mism = j.filter(pl.col("d_close") > CLOSE_MISMATCH).sort("d_close", descending=True)
    notice = j.filter((pl.col("d_close") > CLOSE_NOTICE) & (pl.col("d_close") <= CLOSE_MISMATCH))
    out["close_mismatches"] = mism.height
    out["close_notices"] = notice.height
    out["mismatch_dates"] = [{"date": r["trade_date"].isoformat(), "close_a": r["close_a"], "close_b": r["close_b"],
                              "rel_diff": r["d_close"]} for r in mism.head(MAX_LISTED).iter_rows(named=True)]
    out["median_close_diff_bps"] = None if j.height == 0 else float(j["d_close"].median()) * 10_000
    return out


def _action_value(r: dict) -> float:
    return r["split_to"] / r["split_from"] if r["action_type"] == "split" else r["cash_amount"]


def reconcile_action_frames(aa: pl.DataFrame, ab: pl.DataFrame, symbol: str = "") -> dict:
    ka = {(r["action_type"], r["ex_date"]): r for r in aa.iter_rows(named=True)}
    kb = {(r["action_type"], r["ex_date"]): r for r in ab.iter_rows(named=True)}
    agree, disagree, examples = 0, [], []
    for k in sorted(set(ka) & set(kb)):
        va, vb = _action_value(ka[k]), _action_value(kb[k])
        if (abs(va - vb) <= ACTION_TOLERANCE * abs(va)) if va else (va == vb):
            agree += 1
        else:
            disagree.append({"type": k[0], "ex_date": k[1].isoformat(), "a": va, "b": vb})
    only_a = sorted(set(ka) - set(kb))
    only_b = sorted(set(kb) - set(ka))
    return {"symbol": symbol, "actions_a": len(ka), "actions_b": len(kb), "agree": agree,
            "disagree": len(disagree), "only_in_a": len(only_a), "only_in_b": len(only_b),
            "disagree_examples": disagree[:10],
            "only_in_a_examples": [{"type": t, "ex_date": d.isoformat()} for t, d in only_a[:10]],
            "only_in_b_examples": [{"type": t, "ex_date": d.isoformat()} for t, d in only_b[:10]]}


def reconcile_actions(conn: psycopg.Connection, symbol: str, a: str = "alpaca", b: str = "tiingo",
                      start: date | None = RECON_START, end: date | None = RECON_END) -> dict:
    lo, hi = start or date(1900, 1, 1), end or date(2100, 1, 1)

    def window(df: pl.DataFrame) -> pl.DataFrame:
        return df.filter((pl.col("ex_date") >= lo) & (pl.col("ex_date") <= hi))

    return reconcile_action_frames(window(get_actions(conn, symbol, source=a)),
                                   window(get_actions(conn, symbol, source=b)), symbol)


def _both_sources(conn: psycopg.Connection, a: str, b: str, symbols: list[str] | None) -> list[str]:
    ia = {r["symbol"] for r in list_instruments(conn, a) if r["bars"] > 0}
    ib = {r["symbol"] for r in list_instruments(conn, b) if r["bars"] > 0}
    common = sorted(ia & ib)
    if symbols is not None:
        unknown = [s for s in symbols if s not in common]
        if unknown:
            raise ValueError(f"symbols without both sources: {unknown}")
        return list(dict.fromkeys(symbols))
    return common


def reconcile_universe(conn: psycopg.Connection, symbols: list[str] | None = None, a: str = "alpaca",
                       b: str = "tiingo", start: date | None = RECON_START, end: date | None = RECON_END) -> dict:
    """Per-symbol bar and action reconciliation plus totals. Deterministic for unchanged data."""
    syms = _both_sources(conn, a, b, symbols)
    rows, actions = [], []
    for s in syms:
        rows.append(reconcile_bars(conn, s, a, b, start, end))
        actions.append(reconcile_actions(conn, s, a, b, start, end))
    tot = {k: sum(r[k] for r in rows) for k in ("dates_a", "dates_b", "matched", "only_in_a", "only_in_b",
                                                  "close_mismatches", "close_notices")}
    tot.update({k: sum(r[k] for r in actions) for k in ("agree", "disagree")})
    tot["actions_only_in_a"] = sum(r["only_in_a"] for r in actions)
    tot["actions_only_in_b"] = sum(r["only_in_b"] for r in actions)
    medians = sorted(r["median_close_diff_bps"] for r in rows if r["median_close_diff_bps"] is not None)
    tot["median_of_symbol_median_close_diff_bps"] = medians[len(medians) // 2] if medians else None
    return {"a": a, "b": b, "window": [(start or date(1900, 1, 1)).isoformat(), (end or date(2100, 1, 1)).isoformat()],
            "tolerances": {"close_mismatch": CLOSE_MISMATCH, "close_notice": CLOSE_NOTICE,
                           "action_tolerance": ACTION_TOLERANCE},
            "symbols": len(syms), "totals": tot, "bars": rows, "actions": actions}


def render_markdown(rep: dict) -> str:
    t = rep["totals"]
    lines = [f"# Reconciliation {rep['a']} vs {rep['b']}", "",
             f"Window {rep['window'][0]} to {rep['window'][1]}; {rep['symbols']} symbols. Tolerances (ADR 0013, Appendix A): "
             f"close mismatch > {rep['tolerances']['close_mismatch']:.2%}, notice > {rep['tolerances']['close_notice']:.2%}, "
             f"actions within {rep['tolerances']['action_tolerance']:.1%}. Volume ratios are never flagged.", "",
             f"Totals: matched {t['matched']}, only in {rep['a']} {t['only_in_a']}, only in {rep['b']} {t['only_in_b']}, "
             f"close mismatches {t['close_mismatches']}, notices {t['close_notices']}; actions agree {t['agree']}, "
             f"disagree {t['disagree']}, only in {rep['a']} {t['actions_only_in_a']}, only in {rep['b']} {t['actions_only_in_b']}; "
             f"median close difference {t['median_of_symbol_median_close_diff_bps']:.2f} bps.", "",
             "| symbol | matched | only A | only B | mismatches | notices | median close bps | p99 close bps | volume ratio p50 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in rep["bars"]:
        c = r["price_abs_rel_diff"]["close"]
        lines.append(f"| {r['symbol']} | {r['matched']} | {r['only_in_a']} | {r['only_in_b']} | {r['close_mismatches']} | "
                     f"{r['close_notices']} | {r['median_close_diff_bps']:.2f} | {c['p99'] * 10000:.1f} | "
                     f"{r['volume_ratio_a_over_b']['p50']:.4f} |")
    lines += ["", "## Corporate actions", "", "| symbol | agree | disagree | only A | only B |", "|---|---|---|---|---|"]
    for r in rep["actions"]:
        lines.append(f"| {r['symbol']} | {r['agree']} | {r['disagree']} | {r['only_in_a']} | {r['only_in_b']} |")
    return "\n".join(lines) + "\n"


def write_report(rep: dict, report_dir: Path | None = None, run_id: str | None = None) -> dict:
    """Write reconciliation-<run>.json and .md (the JSON body is identical across runs on unchanged data)."""
    report_dir = report_dir or config.REPORT_DIR
    report_dir.mkdir(parents=True, exist_ok=True)
    run_id = run_id or datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    body = json.dumps(rep, indent=2, sort_keys=True)
    jp, mp = report_dir / f"reconciliation-{run_id}.json", report_dir / f"reconciliation-{run_id}.md"
    jp.write_text(body, encoding="utf-8")
    mp.write_text(render_markdown(rep), encoding="utf-8")
    return {"run_id": run_id, "json": str(jp), "markdown": str(mp)}
