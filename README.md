# Svenska Kort

A mobile-first Swedish flashcard app. Type the English, flip the card, keep the streak.
Free, no account required to start, and fully usable offline once loaded.

**[svenskakort.se](https://svenskakort.se)**

## What it does

- A deck of Swedish vocabulary, grouped by topic (news, school, everyday life, numbers,
  colours, food, the body, and more), each word shown with its full grammatical forms.
- Quizzes in both directions — Swedish → English and English → Swedish.
- Streaks, session scores, and badges to come back for.
- A transfer code to pick a session back up on a second device, no account needed.
- Works offline as an installable PWA once it's been opened once.

## Stack

React 19 + TypeScript + Vite, deployed as a static site to GitHub Pages at the apex
domain. Phase 3 adds a small Cloudflare Worker (`worker/`) for the leaderboard and
badges — see [`worker/README.md`](worker/README.md) — but the app is fully playable on
local data with no backend at all.

## Local setup

Requires Node 22 (see `.nvmrc`); Vite 7 does not run on Node 18.

```
nvm use
npm install
npm run dev
```

`npm run check` runs typecheck, lint, deck validation, and tests before a change ships —
see [`CLAUDE.md`](CLAUDE.md) for the full set of conventions this repo holds itself to.
