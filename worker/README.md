# The Svenska Kort Worker

The API behind phase 3. A plain Cloudflare Worker: no framework, one hand-rolled
router in `src/router.ts`, and an origin-locked CORS allowlist in `src/cors.ts`.

At P02 it serves one route, `GET /api/health`, against a D1 schema that no
handler reads yet.

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

## The database

D1, bound as `DB` in every environment. Local development uses miniflare's own
SQLite file under `worker/.wrangler/`, which never contacts Cloudflare — so the
`database_id` on the top-level binding is the literal string `local` and is not
resolved.

```
npm run db:migrate:local    # apply migrations to the local SQLite file
npm run db:verify:local     # assert the schema is really there
npm run db:seed:local       # fixture devices, sessions and a flagged row
npm run db:rollback:local   # drop everything 0001 created
```

### Creating the remote databases

Needed once, with `wrangler login` or a token in the environment. The printed
`database_id` is an account-scoped uuid, not a secret, and belongs in
`wrangler.toml` so a deploy is reproducible.

```
npx wrangler d1 create svenska-kort-staging
npx wrangler d1 create svenska-kort-prod
```

Put each id in the matching `[[env.*.d1_databases]]` block, replacing
`REPLACE_WITH_STAGING_DATABASE_ID` and `REPLACE_WITH_PROD_DATABASE_ID`.

### Migrations

`migrations/` is applied in filename order by `wrangler d1 migrations apply`.
Two directories deliberately sit outside it, because wrangler applies
*everything* in `migrations/`:

- `migrations-down/` — rollback scripts, run explicitly. A down-migration beside
  its up-migration is one `migrations apply` away from dropping the schema.
- `seeds/` — dev fixtures. There is no `db:seed:staging` or `db:seed:prod`
  script on purpose: the thing keeping fixtures out of a real database should be
  that no command exists to put them there.

CI applies migrations to staging **before** deploying, then runs
`npm run db:verify:staging`. That second step is not belt-and-braces:
`d1 migrations apply` has a history of exiting 0 in GitHub Actions having
applied nothing, so the exit code is not the check. The verification queries
`sqlite_master` and fails the job naming any missing table or index.

### Why the indexes look the way they do

Two of them are partial (`WHERE flags IS NULL`) and there is one more than the
obvious count, because the snapshot builder must read a *bounded* number of rows.
Selecting one row per device with `GROUP BY device_id` / `MAX(score)` needs a
temp B-tree, which is a full pass over the season. Measured locally:

| sessions in table | bounded read | `GROUP BY` |
| --- | --- | --- |
| 20,000 | 3,770 steps | 170,378 steps |
| 120,000 | 3,770 steps | 1,020,378 steps |

The bounded read is flat; the `GROUP BY` is linear. At 120k sessions rebuilding
two scopes every 10 minutes, the `GROUP BY` costs roughly 35M rows read per day
against a 5M daily cap — so it would not merely be slow, it would fail queries.
The builder therefore selects in index order and collapses to one row per device
in memory.

`idx_session_alltime` exists because the all-time scope does not filter on
season and so cannot use an index leading with `season_id`.

**One query reports `SCAN` and is still correct**: the all-time snapshot build
says `SCAN session USING INDEX idx_session_alltime`. It has no temp B-tree, so
it walks the index in score order and stops at its `LIMIT` — the measured cost
is identical at 20k and 120k rows. This is the one documented exception to
"`SCAN` does not merge"; the rule's purpose is to catch unbounded reads, and
this read is bounded. Any *other* `SCAN` still does not merge.

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

## The deployed Workers

| Environment | Origin |
| --- | --- |
| staging | `https://svenska-kort-api-staging.seth-7b6.workers.dev` |
| production | not deployed — P15 promotes it |

`.env.production` points the app at **staging**, because staging is the only
origin that exists yet. P15 swaps it.

Verified against the live staging Worker at P01: a browser on an allowlisted
origin reads `/api/health`, and one on an unlisted origin is refused by the
CORS check rather than by the network — the same request in `mode: 'no-cors'`
still reaches the Worker, which is what proves the refusal is the allowlist
doing its job.
