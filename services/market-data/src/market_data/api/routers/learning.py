"""Swagger section "Learning": blind episodes, precommitted guesses, scores and the reveal (Sprint 06).

These endpoints are INTERNAL: the NestJS gateway calls them, the browser never does. When the environment variable
INTERNAL_API_TOKEN is set, every call must carry the header X-Internal-Token with that value (401 otherwise); when it
is unset (plain local Swagger use) the check is off.
Writes: POST /episodes, /advance, /predictions, /reveal (research schema). Everything else only reads.
"""

from __future__ import annotations

import hmac
import math
import os
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from market_data.learning import episode as ep
from market_data.learning import scoring


def _clean(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    return obj


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.environ.get("INTERNAL_API_TOKEN", "")
    if not expected:
        return
    if x_internal_token is None or not hmac.compare_digest(x_internal_token.encode(), expected.encode()):
        raise HTTPException(401, "internal token required")


class CreateEpisodeIn(BaseModel):
    kind: Literal["mixed", "real", "synthetic"] = Field("mixed", description="mixed hides whether the series is real or generated until the reveal")
    n_bars: int = Field(250, ge=60, le=500)
    initial_visible: int = Field(60, ge=20, le=499)
    seed: int | None = Field(None, ge=0, le=2**31 - 1, description="optional: the same seed rebuilds the same episode")


class AdvanceIn(BaseModel):
    n: int = Field(1, ge=1, le=ep.MAX_ADVANCE)


class PredictionIn(BaseModel):
    horizon: Literal[1, 5, 10] = Field(..., description="bars ahead")
    p_up: float = Field(..., ge=scoring.P_MIN, le=scoring.P_MAX, description="probability that the close then is higher than the close now")


class StatesIn(BaseModel):
    episode_ids: list[str] = Field(..., max_length=500)


class SummaryIn(BaseModel):
    episode_ids: list[str] = Field(..., max_length=500)


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(tags=["Learning"], dependencies=[Depends(require_internal_token)])
    Conn = Depends(conn_dep)

    def guard(fn, *args, **kwargs):
        try:
            return fn(*args, **kwargs)
        except ep.EpisodeNotFound as exc:
            raise HTTPException(404, "unknown episode") from exc
        except ep.EpisodeClosed as exc:
            raise HTTPException(409, "this episode is revealed") from exc
        except ep.InvalidRequest as exc:
            raise HTTPException(422, str(exc)) from exc

    @r.post("/episodes", summary="create_episode: open a blind episode (writes)")
    def create(req: CreateEpisodeIn, conn: psycopg.Connection = Conn) -> dict:
        return guard(ep.create_episode, conn, req.kind, req.n_bars, req.initial_visible, req.seed)

    @r.post("/episodes/states", summary="get_public_many: public state of several episodes in one call (unknown ids are skipped)")
    def states(req: StatesIn, conn: psycopg.Connection = Conn) -> dict:
        return {"episodes": ep.get_public_many(conn, req.episode_ids)}

    @r.get("/episodes/{episode_id}", summary="get_public: state of an episode, no identity")
    def get(episode_id: str, conn: psycopg.Connection = Conn) -> dict:
        return guard(ep.get_public, conn, episode_id)

    @r.get("/episodes/{episode_id}/bars", summary="episode_bars: blind bars up to the cursor (day, rebased OHLC, relative volume)")
    def bars(episode_id: str, conn: psycopg.Connection = Conn) -> dict:
        return {"episode_id": episode_id, "bars": _clean(guard(ep.episode_bars, conn, episode_id))}

    @r.post("/episodes/{episode_id}/advance", summary="advance_episode: move the cursor forward 1 to 20 bars and resolve due guesses (writes)")
    def advance(episode_id: str, req: AdvanceIn, conn: psycopg.Connection = Conn) -> dict:
        return guard(ep.advance_episode, conn, episode_id, req.n)

    @r.post("/episodes/{episode_id}/predictions", summary="add_prediction: store a guess at the server's cursor; append-only, idempotent (writes)")
    def add_prediction(episode_id: str, req: PredictionIn, conn: psycopg.Connection = Conn) -> dict:
        return guard(ep.add_prediction, conn, episode_id, req.horizon, req.p_up)

    @r.get("/episodes/{episode_id}/predictions", summary="list_predictions: guesses of an episode (outcome only when resolved)")
    def predictions(episode_id: str, conn: psycopg.Connection = Conn) -> dict:
        return {"episode_id": episode_id, "predictions": guard(ep.list_predictions, conn, episode_id), "counts": guard(ep.counts, conn, episode_id)}

    @r.get("/episodes/{episode_id}/score", summary="episode_score: Brier score, calibration bins, baselines, permutation luck check")
    def score(episode_id: str, permutations: int = Query(scoring.N_PERM, ge=100, le=20000), conn: psycopg.Connection = Conn) -> dict:
        return _clean(guard(ep.episode_score, conn, episode_id, permutations))

    @r.post("/episodes/{episode_id}/reveal", summary="reveal: one-way, idempotent; shows identity and the data trail; voids pending guesses (writes)")
    def reveal(episode_id: str, conn: psycopg.Connection = Conn) -> dict:
        return _clean(guard(ep.reveal, conn, episode_id))

    @r.get("/learning/summary", summary="learning_summary: score over all episodes; real/made-up split uses revealed episodes only")
    def summary(permutations: int = Query(scoring.N_PERM, ge=100, le=20000), conn: psycopg.Connection = Conn) -> dict:
        return _clean(ep.learning_summary(conn, None, permutations))

    @r.post("/learning/summary", summary="learning_summary for the listed episode ids only (the gateway passes the ids one learner owns)")
    def summary_for(req: SummaryIn, permutations: int = Query(scoring.N_PERM, ge=100, le=20000), conn: psycopg.Connection = Conn) -> dict:
        return _clean(ep.learning_summary(conn, req.episode_ids, permutations))

    return r
