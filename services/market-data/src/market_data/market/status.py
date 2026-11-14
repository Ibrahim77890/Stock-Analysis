"""What data MarketLab holds, in a summary that is safe to show a learner (Sprint 10, task 10_04).

Reads only. The reply holds counts, date ranges, sources and the fixed caveats. It never holds a file path, a file hash, a key or a
vendor URL. The tables it reads: market.bar_daily, market.instrument, market.ingestion_job, market.data_quality_result, market.macro_observation.
"""

from __future__ import annotations

import psycopg

MIN_SESSIONS = 3000

CAVEATS = [
    "Only symbols that exist today are included, so companies that failed or were removed are missing. This is survivorship bias and it makes past results look better than they were.",
    "Each source is one free vendor feed. A feed is not an official market record and can have gaps or errors.",
    "The price data are licensed for private learning on one machine. They must not be shared.",
    "Everything here is for learning. It is not investment advice.",
]


def data_status(conn: psycopg.Connection) -> dict:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT b.source, count(DISTINCT b.instrument_id)::int, count(*)::int, min(b.trade_date), max(b.trade_date),
                   count(*) FILTER (WHERE false)::int
              FROM market.bar_daily b GROUP BY b.source ORDER BY b.source""")
        base = cur.fetchall()
        cur.execute("""
            SELECT source, count(*)::int FROM (
              SELECT source, instrument_id FROM market.bar_daily GROUP BY source, instrument_id HAVING count(*) >= %s) t GROUP BY source""", (MIN_SESSIONS,))
        long_ones = dict(cur.fetchall())
        cur.execute("""
            SELECT source, max(finished_at) FROM market.ingestion_job WHERE status = 'succeeded' AND kind = 'bars' GROUP BY source""")
        retrieved = dict(cur.fetchall())
        cur.execute("""
            SELECT run_id FROM market.data_quality_result ORDER BY created_at DESC, result_id DESC LIMIT 1""")
        last = cur.fetchone()
        quality = {"run": False, "rules_flagged": 0, "errors": 0, "warnings": 0, "infos": 0}
        if last:
            cur.execute("""
                SELECT count(DISTINCT rule)::int,
                       count(*) FILTER (WHERE severity = 'error')::int, count(*) FILTER (WHERE severity = 'warning')::int,
                       count(*) FILTER (WHERE severity = 'info')::int
                  FROM market.data_quality_result WHERE run_id = %s""", (last[0],))
            rules, errs, warns, infos = cur.fetchone()
            quality = {"run": True, "rules_flagged": rules, "errors": errs, "warnings": warns, "infos": infos}
        cur.execute("SELECT count(DISTINCT series_id)::int, count(*)::int, min(obs_date), max(obs_date) FROM market.macro_observation")
        series, obs, mfirst, mlast = cur.fetchone()
    sources = [{"source": s, "symbols": n, "symbols_with_long_history": long_ones.get(s, 0), "bars": bars,
                "first_date": first, "last_date": last_d, "retrieved_at": retrieved.get(s)} for s, n, bars, first, last_d, _ in base]
    return {"sources": sources, "min_sessions_for_long_history": MIN_SESSIONS, "quality": quality,
            "macro": {"series": series, "observations": obs, "first_date": mfirst, "last_date": mlast},
            "caveats": CAVEATS, "empty": len(sources) == 0}
