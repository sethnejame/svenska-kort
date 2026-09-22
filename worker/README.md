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

  `db:rollback:*` runs them **newest first**, and every new down-migration has to
  be added to the front of that chain. Each file deletes its own row from
  `d1_migrations`, so skipping one leaves a database that believes a migration is
  applied when its schema is gone — and the next `migrations apply` recreates
  nothing.
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
Selecting one row per device with `GROUP BY device_id` / `MAX(score)` and then
ordering by that aggregate to take the top hundred is a full pass over the
season. Measured locally:

| sessions in table | bounded read | `GROUP BY` |
| --- | --- | --- |
| 20,000 | 3,770 steps | 170,378 steps |
| 120,000 | 3,770 steps | 1,020,378 steps |

The `ORDER BY` is the part that reports `USE TEMP B-TREE` — a bare
`GROUP BY device_id` walks `idx_session_device` and reports none. That detail
does not rescue the query: the aggregate is computed for every device in the
season before any `LIMIT` can apply either way, which is what makes the cost
linear. The test in `worker/src/leaderboard.test.ts` asserts the plan of the
*ordered* form, because that is the form the builder would actually have needed.

The bounded read is flat; the `GROUP BY` is linear. At 120k sessions rebuilding
two scopes every 30 minutes, the `GROUP BY` costs roughly 12M rows read per day
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

### Query plans per endpoint

`POST /api/session` (P04). Two rows written, both through the primary key:

```
session replay read-back
  SEARCH s USING INDEX sqlite_autoindex_session_1 (id=?)
  SEARCH d USING INDEX sqlite_autoindex_device_1 (id=?)

device credit guard
  SEARCH device USING INDEX sqlite_autoindex_device_1 (id=?)
  SCALAR SUBQUERY 1
  SEARCH session USING COVERING INDEX sqlite_autoindex_session_1 (id=?)
```

`GET /api/me` (P03), plus the rank lookup added in P05:

```
SEARCH device USING INDEX sqlite_autoindex_device_2 (token_hash=?)
SEARCH leaderboard_snapshot USING INDEX idx_snapshot_device (season_id=? AND scope=? AND device_id=?)
```

`GET /api/leaderboard` (P05). Both reads are indexed searches, and the whole
response is one cached body:

```
board
  SEARCH leaderboard_snapshot USING INDEX sqlite_autoindex_leaderboard_snapshot_1 (season_id=? AND scope=?)

snapshot age
  SEARCH score_histogram USING INDEX sqlite_autoindex_score_histogram_1 (season_id=? AND scope=?)
```

The scheduled rebuild (P05), one statement per scope:

```
week window
  SEARCH s USING INDEX idx_session_leaderboard (season_id=?)
  SEARCH d USING INDEX sqlite_autoindex_device_1 (id=?)

all-time window
  SCAN s USING INDEX idx_session_alltime
  SEARCH d USING INDEX sqlite_autoindex_device_1 (id=?)
```

And the rejected alternative, kept here because it is what the design is a
reaction to:

```
GROUP BY device_id ORDER BY MAX(score) DESC LIMIT 100
  SCAN session USING INDEX idx_session_device
  USE TEMP B-TREE FOR ORDER BY
```

Every one of these is asserted in `worker/src/leaderboard.test.ts` rather than
only pasted here, so a query that changes shape fails the build.

### How rank is answered without counting

`SELECT COUNT(*) FROM session WHERE score > ?` reads every row it counts. At
100k sessions that is ~50 leaderboard requests a day before D1 starts failing
queries, so rank is never counted at read time. Two artefacts are rebuilt on a
schedule instead:

| artefact | rows per scope | what it answers |
| --- | --- | --- |
| `leaderboard_snapshot` | 100 | the board, and an **exact** rank for anyone on it |
| `score_histogram` | ≤ 63 | an **approximate** rank for everyone else |

A rank read is therefore two indexed lookups and at most 64 rows, at any table
size. The learner's own score comes from `device.best_score`, a counter
maintained by the session write, on a row auth has already read — so it costs
nothing extra. Flagged sessions never reach `best_score`, which is why a learner
whose only sessions were flagged gets `rank: null` rather than last place.

The histogram's floors are **quantiles, not even score widths**: they sit at the
scores of the devices at geometrically spaced ranks, from rank 100 out to the
last device. Consecutive floors are then a constant *ratio* of ranks apart, and
since an interpolated rank cannot land outside its own bucket, the relative
error is that ratio whatever the score distribution looks like — about 2.7% at
500 devices. Even-width floors cannot do this: scores have a long tail, so the
top bucket holds one device and the bottom one holds most of them. Twenty even
buckets missed a true rank of 130 by 18 places, which is the measurement that
put the quantile version in.

Accuracy degrades gracefully past a few thousand devices, because the row budget
wins: holding ±5% at 10,000 devices would need ~94 floors, and the board is not
worth 94 rows per scope per rebuild.

### Why the cron is every 30 minutes and not every 10

**Writes are the binding budget, not reads.** A rebuild replaces ~163 rows per
scope, so it writes ~326 per scope and ~652 per run:

| interval | runs/day | writes/day | left for sessions |
| --- | --- | --- | --- |
| 10 min | 144 | ~94,000 | ~3,000 rows → ~1,500 sessions |
| 30 min | 48 | ~31,000 | ~69,000 rows → ~34,500 sessions |

The cap is 100,000 writes a day and a submitted session writes two rows. At ten
minutes the cron alone consumes the allowance and the next learner to finish a
round gets a failed query — the board would be starving the thing it is a
leaderboard *for*. Thirty minutes is the deviation from the ticket; reads are
comfortable either way (~480k against 5M).

`SNAPSHOT_MAX_AGE_MS` in `worker/src/leaderboard.ts` is kept equal to the cron
interval. A shorter staleness allowance would make every read on the lazy path
find the snapshot stale and rebuild it inline, which is the read pattern the
whole module exists to avoid.

### The lazy-rebuild fallback

`LAZY_SNAPSHOT = "1"` in `wrangler.toml` makes a leaderboard read rebuild the
snapshot inline when it finds it stale. It is **off**, and exists only in case
cron triggers turn out not to fire on this plan: discovering that should be a
config edit and a redeploy, not a rewrite. With cron working it only adds tail
latency to whichever request notices first.

`/api/health` reports `snapshotAgeSeconds`, read off the histogram — which
always has at least one row, so "never built" stays distinguishable from "built,
nobody played". A cron that has quietly stopped firing shows up there as a
number that keeps climbing.

### Why the board is unauthenticated and cached

The response is identical for every caller: there is no `isMe` field, on
purpose, and the client marks its own row by `deviceId`. That is what lets one
cached body serve everybody, which is what makes a cache hit cost **zero D1
rows** — asserted in `worker/src/index.test.ts`.

CORS headers are never stored with the body. They vary with the request's
`Origin`, and one origin's headers served to another is either a broken client
or a hole, so `corsHeaders` is applied to every response on the way out, hit or
miss. The cache key is built from the parsed and clamped `scope`, `seasonId` and
`limit` rather than from the URL, so `?limit=50&scope=week` and
`?scope=week&limit=50` are one entry, and a week rollover cannot serve last
week's board.

### Why the session write is one batch, in that order

The credit runs *before* the insert and is guarded on the session row not
existing yet:

```sql
UPDATE device SET total_score = total_score + ?, ...
 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM session WHERE id = ?)
```

That ordering is the idempotency mechanism. The outbox retries without knowing
whether the first attempt landed, so a replay has to be a success that changes
nothing: the session row already exists, `NOT EXISTS` is false, the credit is
skipped, and the batch writes zero rows.

An earlier version guarded on the stored `created_at` matching the request's
own, which collides whenever a retry lands in the same millisecond — and a
double-credited total is a number nothing ever goes back and corrects. The
current guard involves no clock.

Both statements go in one `db.batch()`, which is one D1 transaction, so a
session can never be stored without its credit.

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
