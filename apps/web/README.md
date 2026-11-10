# MarketLab web app

A light-coloured, beginner-friendly app with two parts: the learning loop (look at a hidden chart, say how sure you are, get an honest score) and the Strategy Lab (try a rule on practice years, then open a locked vault once). Vite + React + TypeScript. It talks only to the gateway (`apps/api`). Decision record: `docs/04-adr/0014-gateway-and-web-stack.md`. How the loop works: `docs/02-domain/learning-loop.md`. Hand check: `docs/02-domain/learning-walkthrough.md`.

Needs Node 20.19 or newer.

```bash
npm ci
npm run dev            # http://127.0.0.1:5173 (needs the gateway on :3000 and the Python service on :8000)
npm run build          # type-checks (src and tests) and builds to dist/
npm test               # Vitest + Testing Library (jsdom)
npm run gen:api        # regenerate src/api/schema.d.ts from docs/02-domain/openapi-gateway.json
npm run check:api      # fails if that file is stale
npm run check:copy     # reading-ease and sentence-length checks of all screen text (src/copy)
npm run walk           # scripted browser walk (needs the servers and Edge/Chrome); see --lab and --keyboard in the root README
```
`VITE_API_BASE` (default `http://127.0.0.1:3000`) sets the gateway address.

Design system (Sprint 07): `src/styles/tokens.css` and `global.css` hold the whole look (Inter font, indigo and teal on a cool light background, cards with soft shadows, a sticky top bar, inline SVG icons in `components/Icon.tsx`, decorative art in `components/Art.tsx`). Components use tokens only; canvas charts take their colours from `src/lib/chartTheme.ts`.

Rules the code follows: **light theme only** (`src/styles/tokens.css`; one palette, `color-scheme: light`, no dark rules; a test checks WCAG contrast of every token pair); **plain language** (all screen text lives in `src/copy`, with `{{slug|label}}` markers that become clickable word explanations; a test requires reading ease of 60 or more and no sentence over 25 words); **colour is never the only signal** (arrows and words); **no identity before the reveal** (components read only typed fields; tests scan the DOM for names, dates and years); **no business logic in the browser** (every number comes from the API). The token is kept in memory and `sessionStorage` only. Charts: TradingView Lightweight Charts (the credit is shown on every page as the licence requires).

Layout: `src/api` (typed client and generated types), `src/auth`, `src/components` (Layout, Term, Tour, ui), `src/pages`, `src/episode` (chart, guess form, list, coach), `src/score` (meter, calibration plot, luck, reveal), `src/hood` (visibility page), `src/journal` (decision card, My decisions page), `src/episode/Indicators.tsx` (toggles, RSI panel, number tables), `src/lessons` (learning path, lesson page, questions, three demos on made-up data), `src/lab` (Strategy Lab: stock picker, rule form, results, ideas tried, vault), `src/copy`, `src/lib`, `test/`.
