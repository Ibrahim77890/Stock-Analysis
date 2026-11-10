# MarketLab

An educational market-data and research platform. It stores daily stock prices, tests trading ideas honestly (costs, luck, number of tries) and teaches people to doubt their own results. Everything runs on your own machine.

> Education only. Nothing here is financial advice, and no result shown by the app proves a profitable strategy. Tiingo data is licensed for internal use: run the stack locally and do not share the real charts.

## What is in this repository

| Part | Folder | What it does | Port |
|---|---|---|---|
| PostgreSQL | (system service) | Stores everything; schemas `market`, `research` (Python) and `app` (gateway) | 5432 |
| Python service | `services/market-data` | Data download, validation, backtests, learning episodes and scoring. FastAPI with Swagger | 8000 |
| NestJS gateway | `apps/api` | Logins, ownership, validation, glossary. The only API the web app calls. Swagger | 3000 |
| Web app | `apps/web` | The beginner-friendly interface (Vite + React): the learning loop and the Strategy Lab | 5173 |

The browser talks to the gateway, the gateway talks to the Python service, and the Python service talks to PostgreSQL. More in `docs/02-domain/system-overview.md`.

Other folders: `docs/` (domain notes, ADRs, benchmarks, OpenAPI files), `sprints/` (plans, concepts and tasks per sprint), `agent/` (planner instructions), `data/` (downloaded vendor data and reports, git-ignored).

## Prerequisites

- **PostgreSQL** running on `localhost:5432` (a normal system service, no Docker).
- **Python 3.14** and **uv** (`https://docs.astral.sh/uv/`). If `uv` is not on your PATH, use `.venv/Scripts/python.exe -m ...` (Windows) or `.venv/bin/python -m ...` instead.
- **Node.js 20.19 or newer** and **npm**.

## First-time setup

Run these once from the repository root.

```bash
# 1. Settings and secrets (the real .env is git-ignored; never commit it)
cp .env.example .env
#    Edit .env: set POSTGRES_PASSWORD and make DATABASE_URL match it.
#    Generate JWT_SECRET and INTERNAL_API_TOKEN (run twice, one value each):
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#    Data keys (ALPACA_*, TIINGO_API_KEY, FRED_API_KEY) are only needed to download data.

# 2. Python environment and database tables
cd services/market-data
uv sync
uv run poe db-init            # once: creates the role and database (on Windows run scripts/db/db_init.sql with psql as the postgres user)
uv run poe migration-run      # creates the tables in schemas market and research
cd ../..

# 3. Gateway: install, build, create the `app` schema, load the glossary
cd apps/api
npm ci
npm run build
npm run migrate:up
npm run seed:glossary
cd ../..

# 4. Web app: install
cd apps/web
npm ci
cd ../..
```

The price data is not stored in git. To fill the database from scratch follow "How to reproduce Sprints 1 to 6" in `services/market-data/README.md` (it needs free Alpaca, Tiingo and FRED keys). Without data the app starts, but the stock charts and the real-data episodes have nothing to show; made-up (synthetic) episodes still work.

## Start everything (three terminals)

Start them in this order. Each command keeps running; stop it with Ctrl+C.

**Terminal 1: Python service (Swagger on port 8000)**
```bash
cd services/market-data
uv run market-data serve
# without uv on PATH: .venv/Scripts/python.exe -m market_data.cli serve
```

**Terminal 2: NestJS gateway (Swagger on port 3000)**
```bash
cd apps/api
npm run build      # only needed after code changes
npm start
```

**Terminal 3: web app**
```bash
cd apps/web
npm run dev
```

## Where to open things

| What | Address |
|---|---|
| Web app (start here) | http://127.0.0.1:5173 |
| Gateway Swagger (accounts, learning, Lab, glossary, system) | http://127.0.0.1:3000/docs |
| Gateway health check | http://127.0.0.1:3000/health |
| Python service Swagger (data, backtests, validation, learning, Lab) | http://127.0.0.1:8000/docs |

All servers bind to `127.0.0.1` (this machine only).

**Using the Swagger pages**
- Python Swagger: open `/docs`, pick an endpoint, press "Try it out", then "Execute". The Learning endpoints are internal: if `INTERNAL_API_TOKEN` is set in `.env`, add the header `X-Internal-Token` with that value (use the lock/Authorize button where shown, or the header field).
- Gateway Swagger: call `POST /auth/register` to create a learner, then `POST /auth/login` to get a token. Press "Authorize" and paste the token to call the guarded endpoints.

## Checking that it works

```bash
# Database reachable?
cd services/market-data && uv run poe db-check
# Gateway and Python service up? (gateway /health reports both)
curl http://127.0.0.1:3000/health
```

In the web app, sign in and open "How does this work?" (the `/hood` page) to see the live status of each part.

## Indicators and practice decisions

Open an episode (**Learn**). Under the chart, switch on the 20-day average, the EMA or the RSI to see what each one describes. Use the **Practice decision** card to record what you would hold and why; **My decisions** in the top bar shows them later with the result in words. Needs the Python migration `0013` (`uv run poe migration-run`). Design: `docs/04-adr/0019-indicators-and-the-practice-journal.md`, `docs/02-domain/journal.md`.

## Follow the learning path

Sign in: you land on **Path**, seven short lessons (candles, what a probability means, the Brier score, calibration, luck and many tries, costs and the vault, indicators and decisions). Each lesson has a few steps, an optional small demo on made-up data and three questions checked by the server. Load the lessons once with `cd apps/api && npm run seed:lessons`. Design: `docs/04-adr/0018-lessons-and-durable-platform-base.md`, `docs/02-domain/lessons.md`.

## Try the Strategy Lab

Sign in, open **Lab** in the top bar, pick a stock (for example AAPL), start a study and run a rule on the practice years. Run a few more rules, then open the vault once. Needs price data in the database (Tiingo, see the Python README). Design: `docs/04-adr/0017-strategy-lab-practice-window-and-vault.md`.

## Repeatable browser walk

With the three servers running, `apps/web` has a scripted walk that drives a real browser (Microsoft Edge or Chrome; set `BROWSER_PATH` to choose):

```bash
cd apps/web
npm run walk                      # the 14-step learning walkthrough
npm run walk -- --keyboard        # steps 2 to 9 with the keyboard only (fails on any mouse click)
npm run walk -- --lab             # the Strategy Lab walk
npm run walk -- --lab --keyboard  # the Lab walk, keyboard only
npm run walk -- --lessons         # the learning path: a lesson with a demo, questions, practice link
npm run walk -- --lessons --keyboard   # the same, keyboard only
npm run walk -- --journal         # indicators, a practice decision, the My decisions page
npm run walk -- --journal --keyboard   # the same, keyboard only
```

It creates throwaway learners named `walk-...` in the real database and saves screenshots under `data/reports/walk/` (git-ignored).

## Tests

| Part | Command | Notes |
|---|---|---|
| Python | `cd services/market-data && .venv/Scripts/python.exe -m pytest tests` | Set `TEST_DATABASE_URL` to a throwaway database to run the database tests (never your real one). |
| Gateway | `cd apps/api && npm test` | Needs `TEST_DATABASE_URL`; the end-to-end spec starts the real Python service. |
| Web | `cd apps/web && npm test` | `npm run build` type-checks the whole app. |

## Common problems

- **Gateway stops at start-up naming a variable:** `DATABASE_URL`, `JWT_SECRET` or `INTERNAL_API_TOKEN` is missing in `.env`. The message never shows a value.
- **Web app shows "can't reach the server":** the gateway (port 3000) or the Python service (port 8000) is not running. Start terminal 1 and 2 first.
- **Learning endpoints return 401 in Python Swagger:** add the `X-Internal-Token` header (see above).
- **Port already in use:** stop the older process, or change `GATEWAY_PORT` in `.env` (and `PYTHON_API_URL` / `CORS_ORIGINS` if you changed the others).

## More documentation

- `docs/02-domain/system-overview.md`: how the three services fit together, secrets, tests.
- `docs/02-domain/learning-walkthrough.md`: a step-by-step tour of the learning loop.
- `services/market-data/README.md`, `apps/api/README.md`, `apps/web/README.md`: details per part.
- `docs/04-adr/`: why each major decision was made.
- `sprints/`: what each sprint planned and which concepts it teaches.
