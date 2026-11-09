# Two backends, one contract: a NestJS gateway and the Python analytics service

**Sprint:** 06    **Used by tasks:** 06_01, 06_06, 06_07, 06_11, 06_12, 06_13

## Why this matters for MarketLab
From this sprint there are learners, and learners must not see each other's episodes. The blueprint (Section 24) splits the work: **NestJS** is the public gateway and owns users, ownership and progress; **Python** owns data and every number. Mixing the two jobs is how a scoring bug ends up in an auth module, or an access-control bug in the analytics code.

## Plain-language explanation
**The ownership rules** (blueprint Section 24):
- NestJS never computes indicators, scores or backtests; Python never handles users or passwords.
- One PostgreSQL database, separate schemas: `market` and `research` belong to Python; **`app`** belongs to NestJS (it creates and migrates it). A service may read another's schema but only the owner writes or migrates it.
- The browser talks to NestJS only. NestJS calls Python on the loopback address with a shared secret header; Python refuses learning requests without it.

**Request path:** browser -> NestJS (checks the login token, checks the learner owns the episode, validates the body) -> Python (does the work) -> NestJS (maps the answer and errors) -> browser.

**Login basics.** The server stores a *hash* of the password, never the password. Use a slow, salted hash: OWASP prefers Argon2id and accepts scrypt (Node has scrypt built in via `node:crypto`, so no native add-on is needed); bcrypt only for legacy systems and it truncates input at 72 bytes. After login the server issues a signed token (JWT) that the browser sends as `Authorization: Bearer ...`; a **guard** rejects requests without a valid token. The signing secret comes from the environment and is never committed.

**Broken access control** is the top web risk (OWASP A01). The classic bug: `GET /episodes/abc123` returns the episode to anyone who guesses the id. The fix is an ownership check on every call: look up `(learner, episode)` in `app.learner_episode`; if the pair is missing, answer **404** (not 403), so an outsider cannot even learn that the id exists.

**Validation.** Every request body is checked (types, ranges) before anything is forwarded, so Python only sees well-formed input; errors from Python are mapped to a small set of safe messages (no stack traces, no internal URLs).

Example: learner A creates episode `e1` (stored as `(A, e1)`). Learner B calls `GET /episodes/e1/bars` with B's token: NestJS finds no `(B, e1)` row and returns 404. A's token works.

## Key terms
- gateway: the one public API in front of internal services.
- schema ownership: only the owning service migrates and writes its schema.
- password hash: slow salted one-way transform of a password.
- JWT: signed token carrying the learner's id and an expiry.
- guard: NestJS component that allows or rejects a request before the handler runs.
- ownership check: verifying the caller owns the object named in the URL.
- DTO: data transfer object, the validated shape of a request body.

## Common mistakes / pitfalls
- Trusting an id from the URL without the ownership lookup (IDOR).
- Returning 403 for someone else's object (confirms it exists); return 404.
- Storing passwords with a fast hash (SHA-256) or logging request bodies that contain passwords or tokens.
- Putting `JWT_SECRET` or the internal token in the repository.
- Forwarding the browser's body unchecked to the internal service.
- Letting the gateway add logic ("just a quick average") that belongs to Python.

## What to implement in this domain
- `app` schema migrated by NestJS (`app.learner`, `app.learner_episode`, `app.glossary_term`), plain SQL migrations.
- Register and login with scrypt hashing and a JWT guard; `GET /me`.
- A learning module that forwards to Python only after validation and ownership checks, with timeouts and error mapping.
- Two local secrets in `.env` (`JWT_SECRET`, `INTERNAL_API_TOKEN`), placeholders in `.env.example`, generated randomly on the learner's machine.

## How to check you understood
1. Which service may create the table `app.learner`? (NestJS; Python only reads, if ever.)
2. Learner B asks for learner A's episode id. Status and why? (404: B has no row in `app.learner_episode`; 403 would confirm the id exists.)
3. Why not store a SHA-256 of the password? (It is fast, so guessing is cheap; use a slow salted hash such as scrypt.)

## References
- [NestJS: First steps](https://docs.nestjs.com/first-steps): project setup; apps need Node 20.19+, while the generator CLI needs a newer Node (read 2026-11-09).
- [NestJS: Authentication](https://docs.nestjs.com/security/authentication): JWT bearer auth, guards, scrypt password hashing (read 2026-11-09; only the first part of the long page was read).
- [NestJS: OpenAPI (Swagger)](https://docs.nestjs.com/openapi/introduction): `@nestjs/swagger` and exporting the document (read 2026-11-09).
- [NestJS: Testing](https://docs.nestjs.com/fundamentals/testing): unit and end-to-end tests with Supertest; the current docs use Vitest (read 2026-11-09).
- [OWASP Top 10 A01: Broken Access Control](https://owasp.org/Top10/A01_2021-Broken_Access_Control/) (unverified content: the page redirected and only the title was seen).
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html): Argon2id preferred, scrypt acceptable, bcrypt legacy with a 72-byte limit (read 2026-11-09).
- [node-pg-migrate](https://salsita.github.io/node-pg-migrate/): SQL/TypeScript migrations for PostgreSQL (read 2026-11-09).
- MarketLab blueprint Section 24 (stack and database ownership rule).
