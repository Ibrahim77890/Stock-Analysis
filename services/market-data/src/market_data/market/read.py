"""Read API for stored bars. The only module (with load.py and quality.py) allowed to query market.bar_daily."""

from datetime import date

import polars as pl
import psycopg

from market_data.core import config
from market_data.market.adjust import Adjustment, adjust_bars

BAR_COLUMNS = {
    "trade_date": pl.Date, "open": pl.Float64, "high": pl.Float64, "low": pl.Float64,
    "close": pl.Float64, "volume": pl.Int64,
}
ACTION_COLUMNS = {
    "action_type": pl.String, "ex_date": pl.Date, "split_from": pl.Float64,
    "split_to": pl.Float64, "cash_amount": pl.Float64,
}


class UnknownSymbolError(LookupError):
    pass


def instrument_id(conn: psycopg.Connection, symbol: str) -> int:
    with conn.cursor() as cur:
        cur.execute("SELECT instrument_id FROM market.instrument WHERE symbol = %s", (symbol,))
        row = cur.fetchone()
    if row is None:
        raise UnknownSymbolError(symbol)
    return row[0]


def list_instruments(conn: psycopg.Connection, source: str = config.SOURCE) -> list[dict]:
    """Instruments with bar counts and date range **of one source** (default alpaca)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT i.symbol, i.name, i.asset_type, i.sector, count(b.*), min(b.trade_date), max(b.trade_date) "
            "FROM market.instrument i LEFT JOIN market.bar_daily b "
            "ON b.instrument_id = i.instrument_id AND b.source = %s "
            "GROUP BY i.instrument_id ORDER BY i.symbol", (source,))
        return [dict(symbol=r[0], name=r[1], asset_type=r[2], sector=r[3], bars=r[4], first_date=r[5], last_date=r[6])
                for r in cur.fetchall()]


def get_actions(conn: psycopg.Connection, symbol: str, as_of: date | None = None,
                source: str = config.SOURCE) -> pl.DataFrame:
    """Corporate actions of a symbol with ex_date <= as_of (all if None)."""
    iid = instrument_id(conn, symbol)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT action_type, ex_date, split_from::float8, split_to::float8, cash_amount::float8 "
            "FROM market.corporate_action WHERE instrument_id = %s AND source = %s "
            "AND (%s::date IS NULL OR ex_date <= %s::date) ORDER BY ex_date, action_type",
            (iid, source, as_of, as_of))
        return pl.DataFrame(cur.fetchall(), schema=ACTION_COLUMNS, orient="row")


def bar_range_stats(conn: psycopg.Connection, symbol: str, cursor: date | None = None,
                    source: str = config.SOURCE) -> dict:
    """Count, first/last date and loader job ids of a symbol's bars up to the cursor."""
    iid = instrument_id(conn, symbol)
    with conn.cursor() as cur:
        cur.execute(
            "SELECT count(*), min(trade_date), max(trade_date), array_agg(DISTINCT ingestion_job_id) "
            "FROM market.bar_daily WHERE instrument_id = %s AND source = %s "
            "AND (%s::date IS NULL OR trade_date <= %s::date)", (iid, source, cursor, cursor))
        n, first, last, jobs = cur.fetchone()
    return {"bars": n, "first_date": first, "last_date": last, "job_ids": sorted(j for j in (jobs or []) if j)}


def session_dates(conn: psycopg.Connection, symbol: str, start: date, source: str = config.SOURCE) -> list[date]:
    """Stored bar dates of a symbol from `start` on (used to move a replay cursor)."""
    iid = instrument_id(conn, symbol)
    with conn.cursor() as cur:
        cur.execute("SELECT trade_date FROM market.bar_daily WHERE instrument_id = %s AND source = %s "
                    "AND trade_date >= %s ORDER BY trade_date", (iid, source, start))
        return [r[0] for r in cur.fetchall()]


def _raw_bars(conn, iid: int, source: str, start: date | None, end: date) -> pl.DataFrame:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT trade_date, open::float8, high::float8, low::float8, close::float8, volume "
            "FROM market.bar_daily WHERE instrument_id = %s AND source = %s "
            "AND (%s::date IS NULL OR trade_date >= %s::date) AND trade_date <= %s ORDER BY trade_date",
            (iid, source, start, start, end))
        return pl.DataFrame(cur.fetchall(), schema=BAR_COLUMNS, orient="row")


def get_bars(
    conn: psycopg.Connection, symbol: str, start: date, end: date,
    source: str = config.SOURCE, max_date: date | None = None,
    adjustment: Adjustment | str = Adjustment.RAW,
) -> pl.DataFrame:
    """Daily bars for `symbol` with start <= trade_date <= end, ordered by date.

    `max_date` caps the returned dates (the replay cursor). The effective end is
    min(end, max_date). With adjustment 'split' or 'split_dividend' the bars are adjusted
    **as of the effective end**: only corporate actions with ex_date <= effective end are
    used, so an adjusted value never depends on data after the cursor. 'raw' returns the
    Sprint 01 shape (no extra columns); adjusted frames add factor, adjustment and as_of.
    Raises ValueError (start > end, unknown adjustment) and UnknownSymbolError.
    """
    mode = Adjustment(adjustment)  # ValueError for unknown values
    if start > end:
        raise ValueError(f"start {start} is after end {end}")
    effective_end = min(end, max_date) if max_date is not None else end
    iid = instrument_id(conn, symbol)
    if mode is Adjustment.RAW:
        return _raw_bars(conn, iid, source, start, effective_end)
    # Dividend factors need the close before each ex-date, so load history from the beginning.
    history = _raw_bars(conn, iid, source, None, effective_end)
    actions = get_actions(conn, symbol, effective_end, source)
    adjusted = adjust_bars(history, actions, effective_end, mode)
    return adjusted.filter(pl.col("trade_date") >= start)


# --------------------------------------------------------------------------- macro (Sprint 05)

MACRO_COLUMNS = {"obs_date": pl.Date, "value": pl.Float64}


def get_macro(conn: psycopg.Connection, series_id: str, start: date | None = None, end: date | None = None,
              source: str = "fred") -> pl.DataFrame:
    """Observations of a macro series (NULL values kept as None), ordered by date.

    Raises LookupError if the series is unknown."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT obs_date, value::float8 FROM market.macro_observation WHERE series_id = %s AND source = %s "
            "AND (%s::date IS NULL OR obs_date >= %s::date) AND (%s::date IS NULL OR obs_date <= %s::date) "
            "ORDER BY obs_date", (series_id, source, start, start, end, end))
        df = pl.DataFrame(cur.fetchall(), schema=MACRO_COLUMNS, orient="row")
    if df.height == 0:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM market.macro_observation WHERE series_id = %s AND source = %s LIMIT 1",
                        (series_id, source))
            if cur.fetchone() is None:
                raise LookupError(f"unknown macro series {series_id}")
    return df


def macro_asof(conn: psycopg.Connection, series_id: str, d: date, strict: bool = True,
               source: str = "fred") -> dict:
    """Latest non-null observation with obs_date < d (strict) or <= d. LookupError if none exists."""
    op = "<" if strict else "<="
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT obs_date, value::float8 FROM market.macro_observation WHERE series_id = %s AND source = %s "
            f"AND obs_date {op} %s AND value IS NOT NULL ORDER BY obs_date DESC LIMIT 1", (series_id, source, d))
        row = cur.fetchone()
        known = True
        if row is None:
            cur.execute("SELECT 1 FROM market.macro_observation WHERE series_id = %s AND source = %s LIMIT 1",
                        (series_id, source))
            known = cur.fetchone() is not None
    if row is None:
        where = "before" if strict else "on or before"
        raise LookupError(f"no observation {where} {d} for {series_id}" if known
                          else f"unknown macro series {series_id}")
    return {"series_id": series_id, "query_date": d, "obs_date": row[0], "value": row[1], "strict": strict}


def source_summary(conn: psycopg.Connection) -> list[dict]:
    """Per price source: symbols, bars, first and last date, and corporate-action counts."""
    with conn.cursor() as cur:
        cur.execute("SELECT source, count(DISTINCT instrument_id), count(*), min(trade_date), max(trade_date) "
                    "FROM market.bar_daily GROUP BY source ORDER BY source")
        bars = {r[0]: r[1:] for r in cur.fetchall()}
        cur.execute("SELECT source, action_type, count(*) FROM market.corporate_action GROUP BY 1, 2")
        acts: dict[str, dict] = {}
        for src, kind, n in cur.fetchall():
            acts.setdefault(src, {})[kind] = n
    return [{"source": s, "symbols": b[0], "bars": b[1], "first_date": b[2], "last_date": b[3],
             "splits": acts.get(s, {}).get("split", 0), "dividends": acts.get(s, {}).get("dividend", 0)}
            for s, b in bars.items()]


def instrument_info(conn: psycopg.Connection, symbol: str) -> dict:
    """Name, type and sector of one symbol (used after a learning episode is revealed)."""
    with conn.cursor() as cur:
        cur.execute("SELECT symbol, name, asset_type, sector FROM market.instrument WHERE symbol = %s", (symbol,))
        row = cur.fetchone()
    if row is None:
        raise UnknownSymbolError(symbol)
    return {"symbol": row[0], "name": row[1], "asset_type": row[2], "sector": row[3]}
