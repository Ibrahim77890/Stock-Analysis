# MarketLab gateway (NestJS)

The only API the web app talks to. It handles accounts, who-owns-what, request validation, the glossary and a per-learner request trace. It owns the database schema `app`. It computes nothing: every number comes from the Python service (`services/market-data`). Decision record: `docs/04-adr/0014-gateway-and-web-stack.md`.

Needs Node 20.19 or newer. Secrets and settings come from the repository-root `.env` (see `.env.example`): `DATABASE_URL`, `JWT_SECRET`, `INTERNAL_API_TOKEN` are required (start-up stops and names the missing variable, never a value); `GATEWAY_PORT`, `PYTHON_API_URL`, `CORS_ORIGINS`, `LOGIN_LIMIT_PER_MINUTE`, `LAB_RUNS_PER_MINUTE` are optional. Generate a secret with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

```bash
npm ci
npm run build
npm run migrate:up            # creates schema app (learner, learner_episode, learner_study, glossary_term); version table app.pgmigrations
npm run seed:glossary         # idempotent: glossary.md + seed/learning-terms.json
npm start                     # http://127.0.0.1:3000 (loopback only), Swagger at /docs
npm test                      # needs TEST_DATABASE_URL (throwaway database); the e2e spec starts the real Python service
npm run gen:python-api        # regenerate src/python/schema.d.ts from docs/02-domain/openapi-market-data.json
npm run check:python-api      # fails if that file is stale
npm run export:openapi        # writes docs/02-domain/openapi-gateway.json (a test compares it with the generated document)
npm run latency               # needs the real stack running; writes docs/03-benchmarks/benchmark-02-learning-api-latency.md
```

Endpoints (Swagger tags): **Account** `POST /auth/register`, `POST /auth/login`, `GET /me`; **Learning** (all guarded, ownership-checked) `POST|GET /episodes`, `GET /episodes/:id`, `/bars`, `POST /advance`, `POST|GET /predictions`, `GET /score`, `POST /reveal`, `GET /me/progress`; **Lab** (all guarded, ownership-checked, rate-limited) `GET /lab/stocks`, `POST|GET /lab/studies`, `GET /lab/studies/:id`, `POST /lab/studies/:id/runs` (20 a minute per learner), `POST /lab/studies/:id/vault` (needs `confirm: true`; 3 tries a minute), `GET /lab/studies/:id/vault`; **Journal** (guarded, ownership-checked) `GET /episodes/:id/indicators?name=sma|ema|rsi&window=`, `POST /episodes/:id/decisions` (30 a minute per learner), `GET /episodes/:id/decisions`; **Lessons** (guarded; answers limited to 60 a minute per learner) `GET /lessons`, `GET /lessons/:slug` (option texts only, no answer key), `POST /lessons/:slug/steps/:n/read`, `POST /lessons/:slug/questions/:n/answer`; **Glossary** (public) `GET /glossary`, `GET /glossary/:slug`; **System** `GET /health` (public), `GET /system`, `GET /trace` (guarded).

Layout: `src/auth` (scrypt passwords, JWT guard, rate limit), `src/learning` (controller, service, `whitelist.ts`), `src/lab` (study routes, per-learner limits, `whitelist.ts`), `src/glossary`, `src/system` (health, system, trace endpoints), `src/trace` (request trace), `src/python` (typed client, generated `schema.d.ts`), `src/db`, `src/config`, `src/common`, `migrations/` (SQL), `seed/`, `scripts/`, `test/`.

Not here: Docker, deployment, password reset, email, OAuth. Tiingo-derived charts are for internal use only: keep this service on loopback.
