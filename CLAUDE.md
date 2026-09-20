# Svenska Kort — the contract

A mobile-first, fully static Swedish flashcard app. React 19 + TypeScript + Vite, deployed to
GitHub Pages at `/svenska-kort/`. No backend in v1.

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

## Naming

Components `PascalCase`, hooks `useThing`, pure helpers `camelCase`, types in `src/types/`.

## Local setup

Requires Node 22 (see `.nvmrc`); Vite 7 does not run on Node 18.

```
nvm use
npm install
npm run dev
```
