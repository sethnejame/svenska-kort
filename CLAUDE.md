# Svenska Kort — the contract

A mobile-first, fully static Swedish flashcard app. React 19 + TypeScript + Vite, deployed to
GitHub Pages at the apex domain `svenskakort.se`, so the Vite `base` is `/`. No backend in v1.

## Hard rules

- **Mobile-first is a hard rule.** Every component is built and checked at 375 px before any wider
  breakpoint is written. Desktop is a widened mobile layout, never a separate design.
- **No component reads `localStorage`.** Persistence goes through the Zustand stores; the only file
  that touches `localStorage` is `src/store/storage.ts`. Scores go through `src/services/scoreStore.ts`.
- **No hard-coded colors, radii, shadows or easings.** Only `var(--token)` from `src/styles/tokens.css`.
- **`src/lib/` stays pure and framework-free** — no React imports, no DOM access, and no `Date.now()`
  called internally. Time is passed in as an argument. These are the files with 100% test coverage.
- **Every component folder holds its `.tsx`, its `.module.css`, and its test.** No shared `components.css`.
- **TypeScript `strict` with `noUncheckedIndexedAccess`.** No `any`, no non-null assertions on parsed
  user input.
- **Swedish text is content, never an identifier.** Code, keys, and comments are English; `åäö` appear
  only in data and UI strings.
- **Conventional commits.** One ticket per commit or small series.
- **Run `npm run check`** (typecheck + lint + validate:decks + test) before declaring a ticket done.
- **Use `dvh`, never `vh`.** This is what keeps the layout still when the mobile keyboard opens.

## No premature abstraction

There is one game mode in v1. Do not build a mode registry, a plugin system, or a generic "card type"
abstraction. The only interface built ahead of its second implementation is `ScoreStore`, and that is
a deliberate exception so phase 3 is a data-source swap rather than a rewrite.

## Phase 3 — the API

Three top-level folders, no workspaces. The arrows only point one way, and ESLint enforces it:

```
src/      the app          — may import shared/, never worker/
shared/   types + pure logic compiled into BOTH — imports neither
worker/   the Cloudflare Worker — may import shared/, never src/
```

`shared/scoring.ts` is why the split exists: the Worker recomputes every submitted session
with the same file the client scored it with, so the two arithmetics cannot drift. `src/lib/scoring.ts`
re-exports it, so app imports are unchanged and there is no second copy.

- **The repo is public.** No API key, token or secret is ever committed or bundled.
  `CLOUDFLARE_API_TOKEN` lives in GitHub Actions secrets and nowhere else. The API base URL is
  public and may be bundled — that is all `.env.production` holds.
- **The Worker never trusts the client.** No client-computed total is ever stored as authoritative.
  Every number the client sends is input to be validated, not a fact.
- **Every D1 query is indexed and bounded.** No query without a `LIMIT`. No `SELECT *` on a table
  that grows. Ship `EXPLAIN QUERY PLAN` in the PR; if it says `SCAN`, it does not merge.
- **Every endpoint degrades.** A failed call leaves the app fully playable on local data. The
  learner should be able to use Svenska Kort on a plane and see a sync state, never an error.
- **Types for the API live in `shared/api.ts` and nowhere else.** A contract that exists twice drifts.
- **10 ms CPU per request.** No password hashing, ever. If a handler does anything that is not
  arithmetic, string work, or a D1 call, question it.
- **Never one D1 row per answer, and never `COUNT(*)` for rank.** One session row with the timings
  as compact JSON; rank from a precomputed snapshot plus a histogram. Both caps are enforced daily
  and breaching them fails queries outright.
- **CORS is an exact origin allowlist, never `*`** — the bearer token is a credential.
  The whole list is `worker/src/cors.ts`.

`shared/` and `worker/src/` are held at 100% coverage alongside `src/lib/`.
`npm run check` typechecks and lints both. See `worker/README.md` for deploys and token rotation.

## Naming

Components `PascalCase`, hooks `useThing`, pure helpers `camelCase`, types in `src/types/`.

## Local setup

Requires Node 22 (see `.nvmrc`); Vite 7 does not run on Node 18.

```
nvm use
npm install
npm run dev
```
