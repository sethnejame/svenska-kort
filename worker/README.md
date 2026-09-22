# The Svenska Kort Worker

The API behind phase 3. A plain Cloudflare Worker: no framework, one hand-rolled
router in `src/router.ts`, and an origin-locked CORS allowlist in `src/cors.ts`.

At P01 it serves exactly one route, `GET /api/health`. There is no database yet.

## Layout

```
shared/   types and pure logic compiled into BOTH the app and this Worker
worker/   this Worker, which may import shared/ and never src/
src/      the app, which may import shared/ and never worker/
```

`shared/scoring.ts` is the reason the split exists: the Worker recomputes every
submitted session with the same file the client scored it with, so the two
arithmetics cannot drift. ESLint enforces the direction of every arrow above —
`shared/` importing from `src/` or `worker/` fails lint.

## Local development

Requires Node 22 (`nvm use`).

```
npm install
npm run worker:dev      # wrangler dev, http://localhost:8787
```

The app's dev server (`npm run dev`, port 5173) and preview server (port 4173)
are both on the CORS allowlist, so local work needs no special case in the
handler. Point the app at the local Worker with a `.env.local`:

```
VITE_API_BASE=http://localhost:8787
```

Verify the Worker directly:

```
curl -s -H 'Origin: https://svenskakort.se' http://localhost:8787/api/health
```

## Deploying

`.github/workflows/deploy-worker.yml` deploys to **staging** on any push to
`master` that touches `worker/**` or `shared/**`. Production is a manual
promotion until P15 wires the tagged release.

```
npm run worker:deploy:staging
npm run worker:deploy:prod
```

`VERSION` is set from the commit SHA by CI so a stale Worker is visible in
`/api/health` rather than guessed at. Locally it is `dev`.

## Required GitHub Actions secrets

Neither value belongs anywhere in the repo.

| Secret | What it is |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | A scoped token — see below. Never an account-wide API key. |
| `CLOUDFLARE_ACCOUNT_ID` | The account id from the Cloudflare dashboard. Not secret, but kept alongside the token so neither is committed. |

### The token's scope

Built from the **Edit Cloudflare Workers** template rather than hand-rolled: a
token carrying only `Workers Scripts:Edit` cannot resolve the account and fails
the deploy with an error that does not say so. The template's reads are what
make `wrangler deploy` work at all.

Two settings matter more than the permission list:

- **Account Resources** — `Include` → this account only, never *All accounts*.
- **Zone Resources** — none. The template asks for `Workers Routes:Edit`, which
  is zone-scoped; delete that row. `svenskakort.se` is not a Cloudflare zone
  (it is registered elsewhere and served by GitHub Pages), and the Worker lives
  on `workers.dev`, so nothing here needs a zone.

`D1:Edit` has to be present — add it if the template omits it, because P02
onwards cannot migrate without it.

The resulting token also carries KV, R2, Pages, Tail and Observability edit
rights. That is wider than this project uses, and is accepted deliberately:
those products are empty on this account, so there is nothing to damage, and
trimming further is the common cause of a deploy that fails obscurely.

### Rotating the token

1. Create the replacement under **My Profile → API Tokens**, following the
   scope above.
2. Update `CLOUDFLARE_API_TOKEN` in **Settings → Secrets and variables →
   Actions** on the GitHub repo.
3. Re-run the workflow to confirm the new token deploys.
4. Only then revoke the old token.

A token is never printed by the workflow and must never be pasted into an issue,
a commit, or a log.

## CORS

`src/cors.ts` holds the entire allowlist. It is exact origins, never `*`,
because the bearer token is a credential. Adding an origin — a new domain, a
preview environment — means editing that array and nothing else.

## Setup still to do

P01 stops short of a live deploy on purpose. To finish it:

1. Create a Cloudflare account (no card required for the free plan).
2. Create the scoped API token and add both secrets to the GitHub repo.
3. Push; the workflow deploys the staging Worker.
4. Put the deployed origin in `.env.production` as `VITE_API_BASE`.
5. Confirm `GET /api/health` from the deployed app, and confirm a request from
   an unlisted origin is refused.
