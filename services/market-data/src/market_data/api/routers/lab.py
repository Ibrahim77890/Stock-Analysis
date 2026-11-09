"""Swagger section "Lab": the Strategy Lab (Sprint 07). Test one moving-average rule on the practice years of a stock,
then open the vault (the most recent years) once.

These endpoints are INTERNAL: the NestJS gateway calls them. When INTERNAL_API_TOKEN is set every call must carry the
header X-Internal-Token (401 otherwise); when it is unset (plain local Swagger use) the check is off.
Writes: POST /lab/studies (a study), POST /lab/studies/{id}/runs (a counted trial) and POST /lab/studies/{id}/vault (the
single vault use). Everything else only reads. Before the vault is opened no response holds a vault date or number.
"""

from __future__ import annotations

import math

import psycopg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from market_data.api.routers.learning import require_internal_token
from market_data.lab import study as lab
from market_data.market.read import UnknownSymbolError


def _clean(obj):
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    return obj


class CreateStudyIn(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=12, pattern=r"^[A-Za-z0-9.\-]+$")
    vault_bars: int = Field(lab.DEFAULT_VAULT_BARS, ge=120, le=1500, description="trading days locked in the vault")
    name: str | None = Field(None, max_length=80)


class RunIn(BaseModel):
    fast: int = Field(..., ge=2, le=lab.MAX_SLOW - 1, description="short average, in trading days")
    slow: int = Field(..., ge=3, le=lab.MAX_SLOW, description="long average, in trading days (longer than fast)")
    cost_bps: float = Field(2.0, ge=0, le=lab.MAX_COST_BPS, description="cost per trade in basis points (0.01 percent)")
    seed: int = Field(1, ge=0, le=2**31 - 1)
    n_paths: int = Field(lab.DEFAULT_PATHS, ge=10, le=lab.MAX_PATHS, description="mixed-up histories for the luck check")


class VaultIn(BaseModel):
    fast: int = Field(..., ge=2, le=lab.MAX_SLOW - 1)
    slow: int = Field(..., ge=3, le=lab.MAX_SLOW)
    cost_bps: float = Field(2.0, ge=0, le=lab.MAX_COST_BPS)


class InfoIn(BaseModel):
    study_ids: list[int] = Field(..., max_length=200)


def make_router(conn_dep) -> APIRouter:
    r = APIRouter(tags=["Lab"], dependencies=[Depends(require_internal_token)])
    Conn = Depends(conn_dep)

    def guard(fn, *args, **kwargs):
        try:
            return _clean(fn(*args, **kwargs))
        except (lab.LabStudyNotFound, UnknownSymbolError) as exc:
            raise HTTPException(404, "unknown study or symbol") from exc
        except lab.LabLimitError as exc:
            raise HTTPException(422, str(exc)) from exc
        except lab.HoldoutAlreadyUsedError as exc:
            raise HTTPException(409, "the vault of this study was already opened") from exc

    @r.get("/lab/stocks", summary="eligible_symbols: stocks with at least 3,000 stored trading days")
    def stocks(conn: psycopg.Connection = Conn) -> dict:
        return {"stocks": guard(lab.eligible_symbols, conn)}

    @r.post("/lab/studies", summary="create_lab_study: open a study with a practice window and a locked vault (writes)")
    def create(req: CreateStudyIn, conn: psycopg.Connection = Conn) -> dict:
        return guard(lab.create_lab_study, conn, req.symbol.upper(), lab.SOURCE, req.vault_bars, req.name)

    @r.post("/lab/studies/info", summary="list_studies_info: short cards for several study ids (unknown ids are skipped)")
    def info(req: InfoIn, conn: psycopg.Connection = Conn) -> dict:
        return {"studies": guard(lab.list_studies_info, conn, req.study_ids)}

    @r.get("/lab/studies/{study_id}", summary="study_overview: ideas tried and whether the vault is open; never vault dates")
    def overview(study_id: int, conn: psycopg.Connection = Conn) -> dict:
        return guard(lab.study_overview, conn, study_id)

    @r.post("/lab/studies/{study_id}/runs", summary="run_practice: the rule vs buy and hold on the practice years; a new rule counts as one idea tried (writes)")
    def run(study_id: int, req: RunIn, conn: psycopg.Connection = Conn) -> dict:
        return guard(lab.run_practice, conn, study_id, req.fast, req.slow, req.cost_bps, req.seed, req.n_paths)

    @r.post("/lab/studies/{study_id}/vault", summary="open_vault: spend the single vault use on one rule that was run on practice (writes, once)")
    def vault(study_id: int, req: VaultIn, conn: psycopg.Connection = Conn) -> dict:
        return guard(lab.open_vault, conn, study_id, req.fast, req.slow, req.cost_bps)

    @r.get("/lab/studies/{study_id}/vault", summary="vault_result: the saved result of an opened vault (422 while it is closed)")
    def saved_vault(study_id: int, conn: psycopg.Connection = Conn) -> dict:
        return guard(lab.vault_result, conn, study_id)

    return r
