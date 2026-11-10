"""Swagger section "Paper": practice decisions on blind episodes (Sprint 09, task 09_03).

INTERNAL (the NestJS gateway calls it). A decision is stored once, never edited, at the server's cursor day. Results use
only days the episode has reached. Replies hold day numbers, stances, the learner's own reason and numbers; no dates, symbols
or episode kind. Writes: POST /episodes/{id}/decisions. When INTERNAL_API_TOKEN is set every call needs X-Internal-Token.
"""

from __future__ import annotations

import math
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from market_data.api.routers.learning import require_internal_token
from market_data.learning import episode as ep
from market_data.learning import paper


def _clean(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    return obj


class DecisionIn(BaseModel):
    stance: Literal["long", "flat"] = Field(..., description="long = hold the stock from today's close; flat = hold nothing")
    reason: str = Field(..., min_length=1, max_length=paper.MAX_REASON, description="why, written before the result is known")
    client_key: str = Field(..., min_length=8, max_length=64, description="the same key twice stores one decision")
    cost_bps: float = Field(2.0, ge=0, le=50, description="cost of changing stance, in basis points")


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(tags=["Paper"], dependencies=[Depends(require_internal_token)])

    def guard(fn, *args):
        try:
            return _clean(fn(*args))
        except ep.EpisodeNotFound as exc:
            raise HTTPException(404, "unknown episode") from exc
        except ep.EpisodeClosed as exc:
            raise HTTPException(409, "this episode is revealed") from exc
        except ep.InvalidRequest as exc:
            raise HTTPException(422, str(exc)) from exc

    @r.post("/episodes/{episode_id}/decisions", summary="record_decision: store a practice stance at the cursor day; append-only, idempotent by client key (writes)")
    def record(episode_id: str, req: DecisionIn, conn: psycopg.Connection = Depends(conn_dep)) -> dict:
        return guard(paper.record_decision, conn, episode_id, req.stance, req.reason, req.client_key, req.cost_bps)

    @r.get("/episodes/{episode_id}/decisions", summary="journal: decisions with their results so far and totals (only days already reached)")
    def get_journal(episode_id: str, conn: psycopg.Connection = Depends(conn_dep)) -> dict:
        return guard(paper.journal, conn, episode_id)

    return r
