# System overview (after Sprint 07)

```mermaid
flowchart LR
  B["Browser<br/>apps/web (Vite + React)<br/>:5173"] -->|"JSON + bearer token"| G["NestJS gateway<br/>apps/api<br/>:3000"]
  G -->|"X-Internal-Token"| P["Python service<br/>services/market-data<br/>:8000"]
  G --> D[("PostgreSQL :5432")]
  P --> D
  D --- A["schema app (NestJS)"]
  D --- R["schema research (Python)"]
  D --- M["schema market (Python)"]
```

| Part | Folder | Port | Owns | Never does |
|---|---|---|---|---|
| Web app | `apps/web` | 5173 | pages, charts, words | compute scores, hold identity before the reveal |
| Gateway | `apps/api` | 3000 | schema `app` (learners, `learner_episode`, `learner_study`, glossary), logins, validation, trace | compute any number |
| Python service | `services/market-data` | 8000 | schemas `market` and `research`, all data and scores, Swagger for every function | handle users or passwords |
| PostgreSQL | native Windows service | 5432 | the three schemas | |

**Strategy Lab data flow (Sprint 07).** `POST /lab/studies` (gateway: ownership row in `app.learner_study`, at most 20 studies per learner) -> Python `create_lab_study` (practice end fixed, vault locked) -> `POST /lab/studies/:id/runs` (validate, ownership, 20 runs a minute) -> Python `run_practice` (practice bars only, adjusted as of the practice end; rule, buy and hold, cost table, luck check, one trial) -> whitelisted reply with at most 300 chart points -> `POST /lab/studies/:id/vault` (type OPEN, `confirm: true`, 3 tries a minute) -> Python `open_vault` (one use) -> vault numbers. Decision record: ADR 0017; what the page shows: `lab.md`.

**Request path:** browser -> gateway (token, ownership, validation) -> Python (work) -> gateway (whitelist the answer, map errors) -> browser. The Python Learning endpoints demand `X-Internal-Token` when `INTERNAL_API_TOKEN` is set, so the browser path is the only path. **Contracts:** `docs/02-domain/openapi-market-data.json` (Python) and `docs/02-domain/openapi-gateway.json` (gateway) are committed and checked by tests; the web and gateway TypeScript types are generated from them.

## Start everything (three terminals)
```bash
# 1. Python service (from services/market-data)
.venv/Scripts/python.exe -m market_data.cli serve            # or: uv run market-data serve
# 2. Gateway (from apps/api)
npm ci && npm run build && npm run migrate:up && npm run seed:glossary && npm start
# 3. Web app (from apps/web)
npm ci && npm run dev                                          # http://127.0.0.1:5173
```
Swagger: Python `http://127.0.0.1:8000/docs`, gateway `http://127.0.0.1:3000/docs`.

## Secrets and keys (names only; values live in the git-ignored `.env`)
`DATABASE_URL`; `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `TIINGO_API_KEY`, `FRED_API_KEY` (data downloads only); `JWT_SECRET`, `INTERNAL_API_TOKEN` (generated locally, Sprint 06). Generate a value with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Placeholders are in `.env.example`.

## Tests
Python: `.venv/Scripts/python.exe -m pytest tests` (set `TEST_DATABASE_URL` for database tests). Gateway: `npm test` in `apps/api` (needs `TEST_DATABASE_URL`; the end-to-end spec starts the real Python service on a free port). Web: `npm test` in `apps/web`; `npm run build` type-checks everything.

## Licence note
Tiingo's free plan is "Internal Use Only": run the stack on this machine only and do not show the real charts to other people. The FRED notice is shown wherever FRED-derived numbers appear.
