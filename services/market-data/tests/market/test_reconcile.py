import json
import re
from datetime import date, timedelta
from pathlib import Path

import polars as pl
import pytest

from market_data.core import config
from market_data.market import reconcile as rc
from market_data.market.reconcile import reconcile_action_frames, reconcile_bars, reconcile_frames, reconcile_universe

D0 = date(2021, 3, 1)
ADR = Path(config.DOCS_DIR) / "04-adr" / "0013-second-source-and-macro-policy.md"


def frame(dates, closes, vol=100):
    return pl.DataFrame({"trade_date": dates, "open": closes, "high": closes, "low": closes, "close": closes,
                         "volume": [vol] * len(dates)},
                        schema={"trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64, "low": pl.Float64,
                                "close": pl.Float64, "volume": pl.Int64})


def days(n, start=0):
    return [D0 + timedelta(days=start + i) for i in range(n)]


def test_golden_five_dates():
    a = frame(days(5), [100.0] * 5)                                   # d0..d4
    b = frame(days(5, 1), [100.0, 100.05, 100.5, 102.0, 99.0])        # d1..d5
    r = reconcile_frames(a, b)
    assert (r["matched"], r["only_in_a"], r["only_in_b"]) == (4, 1, 1)
    assert r["only_in_a_examples"] == [days(1)[0].isoformat()] and r["only_in_b_examples"] == [days(1, 5)[0].isoformat()]
    q = r["price_abs_rel_diff"]["close"]      # diffs [0, 0.0005, 0.005, 0.02], linear quantiles
    assert q["p50"] == pytest.approx(0.00275) and q["p90"] == pytest.approx(0.0155)
    assert q["p99"] == pytest.approx(0.01955) and q["max"] == pytest.approx(0.02)
    assert r["close_mismatches"] == 1 and r["close_notices"] == 1
    assert [m["date"] for m in r["mismatch_dates"]] == [days(1, 4)[0].isoformat()]
    # reconciliation invariant: matched + only_in_x = dates_x
    assert r["matched"] + r["only_in_a"] == r["dates_a"] and r["matched"] + r["only_in_b"] == r["dates_b"]


def test_volume_ratios_reported_and_never_flagged():
    a = frame(days(5), [100.0] * 5, vol=480_000)
    b = frame(days(5), [100.0] * 5, vol=71_000_000)
    r = reconcile_frames(a, b)
    assert r["volume_ratio_a_over_b"]["p50"] == pytest.approx(480_000 / 71_000_000)
    assert r["volume_ratio_a_over_b"]["flagged"] == 0 and r["close_mismatches"] == 0 and r["close_notices"] == 0


def test_boundaries_are_strictly_greater_than():
    a = frame(days(3), [100.0] * 3)
    b = frame(days(3), [100.25, 101.0, 101.01])   # exactly 0.25 % and exactly 1 % (not flagged), 1.01 % (flagged)
    r = reconcile_frames(a, b)
    assert r["close_mismatches"] == 1 and r["close_notices"] == 1  # 1.0% is a notice (<= limit), 0.25% is neither


def test_action_reconciliation_cases():
    cols = {"action_type": pl.String, "ex_date": pl.Date, "split_from": pl.Float64, "split_to": pl.Float64,
            "cash_amount": pl.Float64}
    a = pl.DataFrame([("split", date(2020, 8, 31), 1.0, 4.0, None), ("dividend", date(2022, 9, 19), None, None, 1.03712),
                      ("dividend", date(2022, 12, 19), None, None, 0.65541)], schema=cols, orient="row")
    b = pl.DataFrame([("split", date(2020, 8, 31), 1.0, 4.0, None), ("dividend", date(2022, 9, 19), None, None, 0.51856),
                      ("dividend", date(2022, 12, 19), None, None, 0.6554), ("dividend", date(2023, 3, 20), None, None, 0.5)],
                     schema=cols, orient="row")
    r = reconcile_action_frames(a, b, "QQQ")
    assert (r["agree"], r["disagree"], r["only_in_a"], r["only_in_b"]) == (2, 1, 0, 1)   # 0.65541 vs 0.6554 within 0.5 %
    assert r["disagree_examples"][0]["a"] == pytest.approx(1.03712)


def test_tolerances_in_code_equal_adr_appendix():
    text = ADR.read_text(encoding="utf-8")
    appendix = text[text.index("Appendix A"):]
    mism = float(re.search(r"mismatch\*\* is an absolute relative difference of \*\*more than ([\d.]+)%", appendix).group(1))
    notice = float(re.search(r"notice\*\* is a difference of \*\*more than ([\d.]+)%", appendix).group(1))
    action = float(re.search(r"within \*\*([\d.]+)%\*\* relative", appendix).group(1))
    assert mism / 100 == rc.CLOSE_MISMATCH and notice / 100 == rc.CLOSE_NOTICE and action / 100 == rc.ACTION_TOLERANCE


# ---- database

def put(conn, symbol, source, closes, vols=None, start=D0):
    with conn.cursor() as cur:
        cur.execute("INSERT INTO market.instrument (symbol,name,asset_type) VALUES (%s,%s,'stock') "
                    "ON CONFLICT (symbol) DO NOTHING", (symbol, symbol))
        cur.execute("SELECT instrument_id FROM market.instrument WHERE symbol=%s", (symbol,))
        iid = cur.fetchone()[0]
        cur.execute("INSERT INTO market.ingestion_job (kind,source,file_name,file_sha256,status) VALUES "
                    "('bars',%s,'x','x','succeeded') RETURNING ingestion_job_id", (source,))
        jid = cur.fetchone()[0]
        for i, c in enumerate(closes):
            cur.execute("INSERT INTO market.bar_daily (instrument_id,trade_date,source,open,high,low,close,volume,ingestion_job_id)"
                        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                        (iid, start + timedelta(days=i), source, c, c, c, c, (vols or [1000] * len(closes))[i], jid))
    conn.commit()


def test_plus_five_percent_on_one_date_flags_exactly_that_date(conn):
    closes = [100.0 + i for i in range(10)]
    put(conn, "AAA", "alpaca", closes)
    put(conn, "AAA", "tiingo", closes)
    clean = reconcile_bars(conn, "AAA", start=D0, end=D0 + timedelta(days=30))
    assert clean["close_mismatches"] == 0 and clean["close_notices"] == 0
    with conn.cursor() as cur:
        cur.execute("UPDATE market.bar_daily SET open = open * 1.05, high = high * 1.05, low = low * 1.05, close = close * 1.05 WHERE source='tiingo' AND trade_date=%s",
                    (D0 + timedelta(days=4),))
    conn.commit()
    r = reconcile_bars(conn, "AAA", start=D0, end=D0 + timedelta(days=30))
    assert r["close_mismatches"] == 1 and r["mismatch_dates"][0]["date"] == (D0 + timedelta(days=4)).isoformat()
    assert r["mismatch_dates"][0]["rel_diff"] == pytest.approx(0.05)


def test_universe_report_reproducible_and_only_common_symbols(conn, tmp_path):
    put(conn, "AAA", "alpaca", [100.0, 101.0, 102.0])
    put(conn, "AAA", "tiingo", [100.0, 101.0, 102.1])
    put(conn, "BBB", "alpaca", [10.0, 11.0, 12.0])            # only one source: not reconciled, not an error
    s = dict(start=D0, end=D0 + timedelta(days=10))
    r1, r2 = reconcile_universe(conn, **s), reconcile_universe(conn, **s)
    assert r1 == r2 and r1["symbols"] == 1
    w1 = rc.write_report(r1, tmp_path, "run1")
    w2 = rc.write_report(r2, tmp_path, "run2")
    assert Path(w1["json"]).read_text() == Path(w2["json"]).read_text()
    assert "AAA" in Path(w1["markdown"]).read_text()
    with pytest.raises(ValueError, match="without both sources"):
        reconcile_universe(conn, ["BBB"], **s)
