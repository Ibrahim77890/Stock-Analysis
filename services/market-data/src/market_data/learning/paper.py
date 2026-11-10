"""Practice (paper) decisions on blind episodes (Sprint 09, task 09_03).

This is the ONLY module that runs SQL on research.paper_decision. A decision is a STANCE (long or flat) taken at the
server's cursor day, with a written reason, a client key (a double click stores one row) and a cost in basis points.
Rows are append-only (the database trigger refuses UPDATE and DELETE). Results are computed from the stored decisions
and from the closes of days 1..cursor ONLY, so no result can use a day the replay has not reached.

Marking rule: a stance taken at the close of day d applies to the change of every later day t (d < t <= cursor) until the next
decision. A long stance earns close_t / close_{t-1} - 1; a flat stance earns 0. When the stance differs from the stance
before it (flat before the first decision), cost_bps / 10000 is charged once, at the decision. The result of a decision is
(1 + cost factor) x product of the day factors - 1 over the days marked so far; it is None while no day has been marked.
A stance is not advice, and nothing here scores a person.
"""

from __future__ import annotations

import psycopg

from market_data.learning import episode as ep

MAX_DECISIONS = 250
MAX_REASON = 280
STANCES = ("long", "flat")


def _rows(conn: psycopg.Connection, episode_id: str) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("SELECT decision_id, day, stance, reason, cost_bps::float8 FROM research.paper_decision "
                    "WHERE episode_id = %s ORDER BY day", (episode_id,))
        return [{"decision_id": a, "day": b, "stance": c, "reason": d, "cost_bps": e} for a, b, c, d, e in cur.fetchall()]


def record_decision(conn: psycopg.Connection, episode_id: str, stance: str, reason: str, client_key: str, cost_bps: float = 2.0) -> dict:
    """Store a decision at the SERVER's cursor day. A repeat of the same client key returns the stored row (created=false)."""
    e = ep._get(conn, episode_id)
    if e["status"] != "open":
        raise ep.EpisodeClosed(episode_id)
    if stance not in STANCES:
        raise ep.InvalidRequest("stance must be long or flat")
    reason = reason.strip()
    if not 1 <= len(reason) <= MAX_REASON:
        raise ep.InvalidRequest(f"the reason needs 1 to {MAX_REASON} characters")
    if not 8 <= len(client_key) <= 64:
        raise ep.InvalidRequest("client_key needs 8 to 64 characters")
    if not 0 <= cost_bps <= 50:
        raise ep.InvalidRequest("cost_bps must be between 0 and 50")
    with conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM research.paper_decision WHERE episode_id = %s", (episode_id,))
        if cur.fetchone()[0] >= MAX_DECISIONS:
            cur.execute("SELECT 1 FROM research.paper_decision WHERE episode_id = %s AND client_key = %s", (episode_id, client_key))
            if cur.fetchone() is None:
                raise ep.InvalidRequest(f"an episode can hold at most {MAX_DECISIONS} decisions")
        # One statement decides everything, so simultaneous requests with the same key cannot both insert (and none fails):
        # a conflict on the key (a repeat) or on the day (another decision already holds this day) inserts nothing.
        cur.execute("INSERT INTO research.paper_decision (episode_id, day, stance, reason, client_key, cost_bps) VALUES (%s,%s,%s,%s,%s,%s) "
                    "ON CONFLICT DO NOTHING RETURNING decision_id", (episode_id, e["cursor_pos"], stance, reason, client_key, cost_bps))
        created = cur.fetchone() is not None
        cur.execute("SELECT decision_id FROM research.paper_decision WHERE episode_id = %s AND client_key = %s", (episode_id, client_key))
        mine = cur.fetchone()
    conn.commit()
    if mine is None:
        raise ep.InvalidRequest("you already recorded a decision for this day; move on a day first")
    row = next(r for r in journal(conn, episode_id)["decisions"] if r["decision_id"] == mine[0])
    return {**row, "created": created}


def _closes(conn: psycopg.Connection, episode_id: str) -> list[float]:
    return [b["close"] for b in ep.episode_bars(conn, episode_id)]   # days 1..cursor only


def journal(conn: psycopg.Connection, episode_id: str) -> dict:
    """Decisions with their results so far, and totals. Everything is recomputed from the stored rows."""
    ep._get(conn, episode_id)
    rows = _rows(conn, episode_id)
    closes = _closes(conn, episode_id)
    cursor = len(closes)
    decisions: list[dict] = []
    prev_stance = "flat"
    growth = 1.0
    for i, r in enumerate(rows):
        end = rows[i + 1]["day"] if i + 1 < len(rows) else cursor
        end = min(end, cursor)
        factor = 1.0
        if r["stance"] != prev_stance:
            factor *= 1.0 - r["cost_bps"] / 10000.0
        days_marked = max(0, end - r["day"])
        if r["stance"] == "long":
            for t in range(r["day"] + 1, end + 1):          # day t changes, t <= cursor
                factor *= closes[t - 1] / closes[t - 2]
        result = (factor - 1.0) if days_marked > 0 else None
        if result is not None:
            growth *= factor
        decisions.append({"decision_id": r["decision_id"], "day": r["day"], "stance": r["stance"], "reason": r["reason"],
                          "cost_bps": r["cost_bps"], "days_marked": days_marked,
                          "status": "marked" if days_marked > 0 else "pending", "result": result})
        prev_stance = r["stance"]
    marked = sum(1 for d in decisions if d["status"] == "marked")
    return {"episode_id": episode_id, "day": cursor, "decisions": decisions,
            "totals": {"decisions": len(decisions), "marked": marked, "pending": len(decisions) - marked,
                       "growth": (growth - 1.0) if marked else None,
                       "note": "A few decisions say very little. This is a record to learn from, not a score."}}
