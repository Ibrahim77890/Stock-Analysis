"""Swagger section "Indicators": SMA, EMA and RSI of an episode's VISIBLE bars (Sprint 09, task 09_02).

INTERNAL (the NestJS gateway calls it). Values exist only for days the learner can already see (1..cursor); replies hold
day numbers and numbers, never dates or symbols. Indicators describe the past; they do not forecast.
Reads only. When INTERNAL_API_TOKEN is set every call needs X-Internal-Token.
"""

from __future__ import annotations

from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query

from market_data.api.routers.learning import require_internal_token
from market_data.indicators import ema, rsi, sma
from market_data.learning import episode as ep

FUNCS = {"sma": sma, "ema": ema, "rsi": rsi}


def indicator_for_episode(conn: psycopg.Connection, episode_id: str, name: str, window: int) -> dict:
    """Indicator values for days 1..cursor of a blind episode (rebased closes; RSI does not depend on the scale)."""
    if name not in FUNCS:
        raise ep.InvalidRequest("name must be one of sma, ema, rsi")
    if not 2 <= window <= 200:
        raise ep.InvalidRequest("window must be between 2 and 200")
    bars = ep.episode_bars(conn, episode_id)
    values = FUNCS[name]([b["close"] for b in bars], window)
    return {"episode_id": episode_id, "name": name, "window": window, "day": len(bars),
            "values": [{"day": b["day"], "value": v} for b, v in zip(bars, values) if v is not None]}


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(tags=["Indicators"], dependencies=[Depends(require_internal_token)])

    @r.get("/episodes/{episode_id}/indicators", summary="indicator_for_episode: SMA, EMA or RSI of the days already visible (no dates, no symbols)")
    def indicators(episode_id: str, name: Literal["sma", "ema", "rsi"] = Query(...), window: int = Query(20, ge=2, le=200),
                   conn: psycopg.Connection = Depends(conn_dep)) -> dict:
        try:
            return indicator_for_episode(conn, episode_id, name, window)
        except ep.EpisodeNotFound as exc:
            raise HTTPException(404, "unknown episode") from exc
        except ep.InvalidRequest as exc:
            raise HTTPException(422, str(exc)) from exc

    return r
