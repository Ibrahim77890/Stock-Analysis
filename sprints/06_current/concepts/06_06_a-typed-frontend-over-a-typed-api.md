# A typed frontend over a typed API

**Sprint:** 06    **Used by tasks:** 06_01, 06_08

## Why this matters for MarketLab
Everything so far is reachable only through Swagger. A learner needs a page. The cheapest honest design keeps every number in Python, puts users and ownership in NestJS, and gives the browser a thin, typed client. If the browser re-computed scores, two sources of truth would drift.

## Plain-language explanation
- **Vite** builds and serves the web app (`npm run dev` on port 5173, `npm run build` for static files). It needs Node 20.19 or newer; this machine has 20.19.0.
- **React** renders components from state. Keep state small: the server owns the episode, the browser shows it.
- **Typed client.** NestJS publishes an OpenAPI file (with `@nestjs/swagger`). `openapi-typescript` turns it into TypeScript types, so renaming a field on the server breaks the TypeScript build instead of the page at run time. One npm script regenerates the types; a check fails the build if the committed file is out of date.
- **CORS.** A page on port 5173 calling an API on port 3000 is a cross-origin request; the browser blocks it unless the API replies with `Access-Control-Allow-Origin` for that exact origin. Allow only the two local dev origins (`http://127.0.0.1:5173`, `http://localhost:5173`), never `*`. The browser talks **only to NestJS**; the Python service is not reachable from the page.
- **Lightweight Charts** draws candlesticks. Its licence requires crediting TradingView as the product creator, so the UI shows a visible credit with a link.
- **Accessibility.** Controls need labels and keyboard operation; colour must not be the only signal; normal text needs contrast of at least 4.5:1 (WCAG 1.4.3); a chart needs a text alternative such as a table.
- **Tests.** Vitest runs component tests in a simulated DOM with React Testing Library ("test like a user"). Real-browser automation (Playwright) is deferred.

Example: the field `p_up` is renamed `probability_up` in NestJS. After `npm run gen:api`, `npm run build` fails at the form that used `p_up`, before any learner sees a broken page.

## Key terms
- SPA: single-page application, served as static files plus API calls.
- OpenAPI schema: machine-readable description of an API.
- CORS: browser rule restricting cross-origin requests; servers opt in per origin.
- component test: renders one component and asserts what a user would see.
- attribution: a required visible credit for a library or data source.

## Common mistakes / pitfalls
- `allow_origins` / `origin: "*"` on an API that handles logins.
- Computing the Brier score in TypeScript "to save a request".
- Keeping identity-bearing fields in client state before the reveal (they would sit in the browser's memory and network tab).
- Hard-coding the API URL; read it from an environment variable with a loopback default.
- Letting a chart library show real timestamps: the blind chart must use day numbers only.

## What to implement in this domain
- `apps/web` (the project owner may choose another folder; record it): Vite + React + TypeScript, Lightweight Charts, types generated from the NestJS OpenAPI file, a tiny typed fetch wrapper, an environment variable for the API base URL.
- CORS in NestJS with an explicit origin list (`CORS_ORIGINS`, default the two dev origins) and a test that a foreign origin gets no allow header.
- Vitest + Testing Library set up, and a build check in the sprint wrap-up.

## How to check you understood
1. Why is `Access-Control-Allow-Origin: *` unacceptable for a login API? (Any website the learner visits could then call it from their browser.)
2. What breaks, and when, if a response field is renamed on the server? (The TypeScript build, after regenerating types.)
3. Name two accessibility requirements for the calibration plot. (A text alternative such as a table; colour not the only encoding; sufficient contrast.)

## References
- [Vite: Getting started](https://vite.dev/guide/): templates (`react-ts`) and the Node version requirement (read 2026-11-09).
- [React: Quick start](https://react.dev/learn): components, state, props (read 2026-11-09).
- [Lightweight Charts documentation](https://tradingview.github.io/lightweight-charts/docs): candlestick series and the licence/attribution requirement (read 2026-11-09).
- [openapi-typescript](https://openapi-ts.dev/introduction): generating TypeScript types from an OpenAPI schema (read 2026-11-09).
- [MDN: Cross-Origin Resource Sharing](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS): origins, headers, preflight (read 2026-11-09).
- [Vitest guide](https://vitest.dev/guide/) and [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/): component tests (read 2026-11-09).
- [WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/): text alternatives (1.1.1) and contrast (1.4.3) (read 2026-11-09).
