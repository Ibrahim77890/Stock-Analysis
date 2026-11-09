"""Blind learning episodes and precommitted predictions (Sprint 06, tasks 06_02 and 06_03).

This is the ONLY module that runs SQL on research.episode and research.prediction. Everything a learner can see
before the reveal is built here from bars at positions 1..cursor only; identity (symbol, dates, price level,
absolute volume, real/made-up when the learner asked for "mixed") leaves this module only through `reveal`.
Famous crashes cannot be hidden by presentation, which is why made-up episodes are mixed in and the kind is hidden.
"""

from __future__ import annotations

import random
import secrets
from datetime import date

import polars as pl
import psycopg

from market_data.learning import scoring
from market_data.market import lineage as lineage_mod
from market_data.market.read import get_bars, instrument_info, list_instruments, session_dates
from market_data.market.synthetic import episode_series

KINDS = ("real", "synthetic", "mixed")
HORIZONS = (1, 5, 10)
MAX_ADVANCE = 20
DEFAULT_SOURCE = "tiingo"
EPISODE_COLUMNS = ("episode_id", "seed", "kind", "kind_requested", "symbol", "source", "start_date", "synthetic_vol",
                   "n_bars", "initial_visible", "cursor_pos", "status", "created_at", "revealed_at")


class EpisodeNotFound(LookupError):
    pass


class EpisodeClosed(RuntimeError):
    """The episode is revealed: no advance, no new prediction (HTTP 409)."""


class InvalidRequest(ValueError):
    """The request breaks a documented limit (HTTP 422)."""


# ---------------------------------------------------------------------------------- storage

def _get(conn: psycopg.Connection, episode_id: str) -> dict:
    with conn.cursor() as cur:
        cur.execute(f"SELECT {', '.join(EPISODE_COLUMNS)} FROM research.episode WHERE episode_id = %s", (episode_id,))
        row = cur.fetchone()
    if row is None:
        raise EpisodeNotFound(episode_id)
    return dict(zip(EPISODE_COLUMNS, row))


def _dates(conn: psycopg.Connection, ep: dict) -> list[date]:
    return session_dates(conn, ep["symbol"], ep["start_date"], ep["source"])[: ep["n_bars"]]


def _frame(conn: psycopg.Connection, ep: dict, upto: int) -> pl.DataFrame:
    """Bars of positions 1..upto (open, high, low, close, volume). Real bars are split-adjusted as of the date at
    position `upto`; nothing later is read."""
    if not 1 <= upto <= ep["n_bars"]:
        raise InvalidRequest("position outside the episode")
    if ep["kind"] == "synthetic":
        return episode_series(ep["seed"], ep["n_bars"], ep["synthetic_vol"]).head(upto)
    dates = _dates(conn, ep)
    cursor_date = dates[upto - 1]
    bars = get_bars(conn, ep["symbol"], ep["start_date"], cursor_date, source=ep["source"], max_date=cursor_date,
                    adjustment="split")
    return bars.select("open", "high", "low", "close", "volume").head(upto)


def blind_frame(frame: pl.DataFrame, initial_visible: int) -> pl.DataFrame:
    """Hide identity: day numbers, first visible close = 100, volume relative to the mean of the first bars.

    The scale is taken from bars that are already visible, so it uses no later data; with real data both numerator and
    scale carry the same split factor, so splits stay invisible."""
    scale = 100.0 / frame["close"][0]
    vol_scale = float(frame["volume"].head(initial_visible).mean()) or 1.0
    return frame.select(
        (pl.int_range(pl.len()) + 1).alias("day"),
        *[(pl.col(c) * scale).alias(c) for c in ("open", "high", "low", "close")],
        (pl.col("volume") / vol_scale).alias("rel_volume"),
    )


# ---------------------------------------------------------------------------------- episodes

def create_episode(conn: psycopg.Connection, kind: str = "mixed", n_bars: int = 250, initial_visible: int = 60,
                   seed: int | None = None, source: str = DEFAULT_SOURCE) -> dict:
    if kind not in KINDS:
        raise InvalidRequest(f"kind must be one of {KINDS}")
    if not 60 <= n_bars <= 500:
        raise InvalidRequest("n_bars must be between 60 and 500")
    if not 20 <= initial_visible < n_bars:
        raise InvalidRequest("initial_visible must be at least 20 and less than n_bars")
    seed = secrets.randbits(31) if seed is None else int(seed)
    rng = random.Random(seed)
    actual = kind if kind != "mixed" else ("real" if rng.random() < 0.5 else "synthetic")
    symbol = start = vol = None
    if actual == "real":
        eligible = sorted(r["symbol"] for r in list_instruments(conn, source) if r["bars"] >= n_bars)
        if not eligible:
            raise InvalidRequest(f"no symbol in source {source!r} has {n_bars} bars")
        symbol = rng.choice(eligible)
        dates = session_dates(conn, symbol, date(1900, 1, 1), source)
        start = dates[rng.randrange(0, len(dates) - n_bars + 1)]
    else:
        vol = round(rng.uniform(0.15, 0.45), 4)
        source = None
    episode_id = secrets.token_hex(4)
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO research.episode (episode_id, seed, kind, kind_requested, symbol, source, start_date, "
            "synthetic_vol, n_bars, initial_visible, cursor_pos) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (episode_id, seed, actual, kind, symbol, source, start, vol, n_bars, initial_visible, initial_visible))
    conn.commit()
    return get_public(conn, episode_id)


def get_public(conn: psycopg.Connection, episode_id: str) -> dict:
    """What anyone may know: no identity. The actual kind of a 'mixed' episode stays hidden until the reveal."""
    ep = _get(conn, episode_id)
    out = {"episode_id": ep["episode_id"], "n_bars": ep["n_bars"], "initial_visible": ep["initial_visible"],
           "day": ep["cursor_pos"], "status": ep["status"], "kind_requested": ep["kind_requested"]}
    if ep["kind_requested"] != "mixed" or ep["status"] == "revealed":
        out["kind"] = ep["kind"]
    return out


def get_public_many(conn: psycopg.Connection, episode_ids: list[str]) -> list[dict]:
    """Public state of several episodes in one query (unknown ids are skipped); same fields as get_public."""
    if not episode_ids:
        return []
    with conn.cursor() as cur:
        cur.execute(f"SELECT {', '.join(EPISODE_COLUMNS)} FROM research.episode WHERE episode_id = ANY(%s)", (list(episode_ids),))
        rows = [dict(zip(EPISODE_COLUMNS, r)) for r in cur.fetchall()]
    out = []
    for ep in rows:
        item = {"episode_id": ep["episode_id"], "n_bars": ep["n_bars"], "initial_visible": ep["initial_visible"],
                "day": ep["cursor_pos"], "status": ep["status"], "kind_requested": ep["kind_requested"]}
        if ep["kind_requested"] != "mixed" or ep["status"] == "revealed":
            item["kind"] = ep["kind"]
        out.append(item)
    return out


def episode_bars(conn: psycopg.Connection, episode_id: str) -> list[dict]:
    """Blind bars for positions 1..cursor. Always blind, even after the reveal (identity comes from `reveal`)."""
    ep = _get(conn, episode_id)
    frame = blind_frame(_frame(conn, ep, ep["cursor_pos"]), ep["initial_visible"])
    return frame.to_dicts()


def advance_episode(conn: psycopg.Connection, episode_id: str, n: int = 1) -> dict:
    """Move the cursor forward (1..20 positions) and resolve every prediction whose answer bar has now arrived."""
    if not 1 <= n <= MAX_ADVANCE:
        raise InvalidRequest(f"n must be between 1 and {MAX_ADVANCE}")
    ep = _get(conn, episode_id)
    if ep["status"] != "open":
        raise EpisodeClosed(episode_id)
    new_pos = min(ep["n_bars"], ep["cursor_pos"] + n)
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE research.episode SET cursor_pos = %s WHERE episode_id = %s", (new_pos, episode_id))
        _resolve(conn, {**ep, "cursor_pos": new_pos}, new_pos)
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return get_public(conn, episode_id)


def _resolve(conn: psycopg.Connection, ep: dict, cursor_pos: int) -> None:
    """Fill the outcome of pending predictions with made_at + horizon <= cursor_pos, reading closes of positions <= cursor_pos."""
    with conn.cursor() as cur:
        cur.execute("SELECT prediction_id, made_at, horizon FROM research.prediction WHERE episode_id = %s "
                    "AND status = 'pending' AND made_at + horizon <= %s ORDER BY prediction_id", (ep["episode_id"], cursor_pos))
        due = cur.fetchall()
        if not due:
            return
        closes = _frame(conn, ep, cursor_pos)["close"].to_list()   # positions 1..cursor_pos only
        for pid, made_at, horizon in due:
            outcome = 1 if closes[made_at + horizon - 1] > closes[made_at - 1] else 0   # ties count as 0
            cur.execute("UPDATE research.prediction SET outcome = %s, status = 'resolved', resolved_at_pos = %s "
                        "WHERE prediction_id = %s", (outcome, cursor_pos, pid))


# ---------------------------------------------------------------------------------- predictions

def add_prediction(conn: psycopg.Connection, episode_id: str, horizon: int, p_up: float) -> dict:
    """Store a guess at the SERVER's cursor. Append-only; a repeat of the same (position, horizon) returns the first."""
    ep = _get(conn, episode_id)
    if ep["status"] != "open":
        raise EpisodeClosed(episode_id)
    if horizon not in HORIZONS:
        raise InvalidRequest(f"horizon must be one of {HORIZONS}")
    if not scoring.P_MIN <= float(p_up) <= scoring.P_MAX or round(float(p_up), 4) != float(p_up):
        raise InvalidRequest(f"p_up must be between {scoring.P_MIN} and {scoring.P_MAX} with at most 4 decimals")
    made_at = ep["cursor_pos"]
    if made_at + horizon > ep["n_bars"]:
        raise InvalidRequest("the answer bar would lie beyond the end of the episode")
    with conn.cursor() as cur:
        cur.execute("INSERT INTO research.prediction (episode_id, made_at, horizon, p_up) VALUES (%s,%s,%s,%s) "
                    "ON CONFLICT (episode_id, made_at, horizon) DO NOTHING RETURNING prediction_id", (episode_id, made_at, horizon, p_up))
        created = cur.fetchone() is not None
    conn.commit()
    rows = [r for r in list_predictions(conn, episode_id) if r["day"] == made_at and r["horizon"] == horizon]
    return {**rows[0], "created": created}


def list_predictions(conn: psycopg.Connection, episode_id: str) -> list[dict]:
    _get(conn, episode_id)
    with conn.cursor() as cur:
        cur.execute("SELECT prediction_id, made_at, horizon, p_up::float8, status, outcome FROM research.prediction "
                    "WHERE episode_id = %s ORDER BY prediction_id", (episode_id,))
        return [{"prediction_id": a, "day": b, "horizon": c, "p_up": d, "status": e,
                 "outcome": f if e == "resolved" else None} for a, b, c, d, e, f in cur.fetchall()]


def counts(conn: psycopg.Connection, episode_id: str) -> dict:
    rows = list_predictions(conn, episode_id)
    c = {"resolved": 0, "void": 0, "pending": 0}
    for r in rows:
        c[r["status"]] += 1
    c["total"] = len(rows)
    if c["resolved"] + c["void"] + c["pending"] != c["total"]:
        raise RuntimeError("prediction counts do not reconcile")
    return c


# ---------------------------------------------------------------------------------- scores, reveal

def episode_score(conn: psycopg.Connection, episode_id: str, n_perm: int = scoring.N_PERM) -> dict:
    rows = [r for r in list_predictions(conn, episode_id) if r["status"] == "resolved"]
    out = scoring.summarise([r["p_up"] for r in rows], [r["outcome"] for r in rows], [r["horizon"] for r in rows], n_perm)
    return {"episode_id": episode_id, "counts": counts(conn, episode_id), **out}


def learning_summary(conn: psycopg.Connection, episode_ids: list[str] | None = None, n_perm: int = scoring.N_PERM) -> dict:
    """Score over resolved predictions of all episodes (or of the listed ones). The real/made-up split only uses
    REVEALED episodes, because the kind of an open 'mixed' episode is still hidden from the learner."""
    sql = ("SELECT p.p_up::float8, p.outcome, p.horizon, e.kind, e.status FROM research.prediction p "
           "JOIN research.episode e USING (episode_id) WHERE p.status = 'resolved'")
    params: tuple = ()
    if episode_ids is not None:
        sql += " AND p.episode_id = ANY(%s)"
        params = (list(episode_ids),)
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    def score(sel):
        return scoring.summarise([r[0] for r in sel], [int(r[1]) for r in sel], [r[2] for r in sel], n_perm)

    out = {"overall": score(rows), "by_kind": {}, "by_horizon": {}}
    for kind in ("real", "synthetic"):
        sel = [r for r in rows if r[4] == "revealed" and r[3] == kind]
        out["by_kind"][kind] = {"n": len(sel), "brier": scoring.brier([r[0] for r in sel], [int(r[1]) for r in sel])}
    for h in HORIZONS:
        sel = [r for r in rows if r[2] == h]
        out["by_horizon"][str(h)] = {"n": len(sel), "brier": scoring.brier([r[0] for r in sel], [int(r[1]) for r in sel])}
    return out


def reveal(conn: psycopg.Connection, episode_id: str) -> dict:
    """One-way, idempotent. The only place identity leaves this module."""
    ep = _get(conn, episode_id)
    if ep["status"] == "open":
        with conn.cursor() as cur:
            cur.execute("UPDATE research.episode SET status = 'revealed', revealed_at = now() WHERE episode_id = %s", (episode_id,))
            cur.execute("UPDATE research.prediction SET status = 'void' WHERE episode_id = %s AND status = 'pending'", (episode_id,))
        conn.commit()
        ep = _get(conn, episode_id)
    out = {"episode_id": episode_id, "kind": ep["kind"], "seed": ep["seed"], "counts": counts(conn, episode_id)}
    if ep["kind"] == "synthetic":
        out.update(synthetic_volatility=ep["synthetic_vol"],
                   statement="This series was generated by a random-walk program; no market date or symbol exists for it.")
        return out
    dates = _dates(conn, ep)
    info = instrument_info(conn, ep["symbol"])
    lin = lineage_mod.lineage(conn, ep["symbol"], dates[-1], source=ep["source"])
    manifest = lin.get("manifest") or {}
    out.update(identity={**info, "first_date": dates[0], "last_date": dates[-1], "source": ep["source"]},
               data_trail={"provider": manifest.get("provider", ep["source"]), "retrieved_at": manifest.get("retrieved_at"),
                           "feed_caveat": lin["feed_caveat"], "universe_caveat": lin["universe_caveat"],
                           "adjustment": "Prices were adjusted for splits as of the last day you saw; dividends are not included.",
                           "stored_adjustment": lin["stored_adjustment"], "file_hash_matches": manifest.get("hash_matches"),
                           "warnings": lin["warnings"],
                           "licence": "Tiingo data are for internal use only: do not share this page."})
    return out
