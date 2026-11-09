"""Replay data-access layer: a server-side cursor that bounds everything a viewer can see.

Invariant (blueprint 26.3): no result ever contains a bar dated after the cursor, and adjusted
values are computed as of the cursor. All replay reads go through `visible_bars`; the cursor
is a trading date compared with `<=`. A session can only move forward.
"""

from dataclasses import dataclass
from datetime import date

import polars as pl
import psycopg

from market_data.core import config
from market_data.market.adjust import Adjustment
from market_data.market.read import get_bars, session_dates


@dataclass
class ReplaySession:
    symbol: str
    start: date
    cursor: date
    source: str = config.SOURCE

    def advance(self, conn: psycopg.Connection, n_sessions: int = 1) -> date:
        """Move the cursor forward by n stored sessions. At the last stored session the cursor
        stops there (it never goes beyond the data). n_sessions must be >= 1."""
        if n_sessions < 1:
            raise ValueError("a replay cursor can only move forward (n_sessions >= 1)")
        later = [d for d in session_dates(conn, self.symbol, self.start, self.source) if d > self.cursor]
        if later:
            self.cursor = later[min(n_sessions, len(later)) - 1]
        return self.cursor


def new_session(conn: psycopg.Connection, symbol: str, start: date, source: str = config.SOURCE) -> ReplaySession:
    """Open a session whose cursor starts on the first stored session on or after `start`."""
    dates = session_dates(conn, symbol, start, source)
    if not dates:
        raise ValueError(f"no bars for {symbol} on or after {start}")
    return ReplaySession(symbol, start, dates[0], source)


def visible_bars(conn: psycopg.Connection, session: ReplaySession,
                 adjustment: Adjustment | str = Adjustment.SPLIT) -> pl.DataFrame:
    """The only way replay reads bars: start..cursor, adjusted as of the cursor."""
    return get_bars(conn, session.symbol, session.start, session.cursor, source=session.source,
                    max_date=session.cursor, adjustment=adjustment)


def blind_view(bars: pl.DataFrame) -> pl.DataFrame:
    """Hide identity: drop symbol and real dates, label rows day 1..n, rebase to 100.

    The first visible close becomes exactly 100 (the same factor is applied to open, high,
    low, close), so returns are unchanged but the absolute price level is hidden. This is
    presentation, not security; the cursor still applies to the input.
    """
    if bars.height == 0:
        return pl.DataFrame(schema={"day": pl.Int64, "open": pl.Float64, "high": pl.Float64,
                                    "low": pl.Float64, "close": pl.Float64, "volume": pl.Int64})
    scale = 100.0 / bars["close"][0]
    return bars.select(
        (pl.int_range(pl.len()) + 1).alias("day"),
        *[(pl.col(c) * scale).alias(c) for c in ("open", "high", "low", "close")],
        pl.col("volume"),
    )
