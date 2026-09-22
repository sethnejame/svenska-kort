-- 0001_init.sql — the whole phase 3 schema.
--
-- Two design decisions here are load-bearing and cost money to reverse, so they
-- are spelled out rather than left to be inferred:
--
-- 1. `session.timings` is ONE JSON column, not a row per answer. A 71-card
--    session written a row at a time is 71 writes, which caps the free tier at
--    ~1,408 sessions/day. One session row plus one device upsert is 2 writes,
--    which caps it at 50,000.
--
-- 2. `leaderboard_snapshot` and `score_histogram` exist so rank never costs a
--    `COUNT(*)`. Counting rows to find a rank reads every row it counts, which
--    caps the leaderboard at ~50 requests/day. Reading a precomputed snapshot
--    caps it at 100,000.
--
-- Since 2026-09-01 Cloudflare enforces the D1 free-tier daily row limits by
-- failing queries outright, so both of the above are correctness requirements
-- rather than optimizations.

-- A device is the account. No email, no password, no OAuth: the 10 ms CPU limit
-- per request cannot run a real password KDF, so the platform picks this design
-- as much as the taste for simplicity does.
CREATE TABLE device (
  id            TEXT PRIMARY KEY,           -- uuid, server-generated
  token_hash    TEXT NOT NULL UNIQUE,       -- sha-256 of the bearer token, hex
  display_name  TEXT NOT NULL,
  avatar_seed   TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  total_score   INTEGER NOT NULL DEFAULT 0,
  best_streak   INTEGER NOT NULL DEFAULT 0,
  -- Maintained as counters in the session handler's existing batch. Two badges
  -- (`hundred-words`, `all-decks`) need a distinct count, and a query per
  -- submission to derive it would cost more than the badges are worth.
  distinct_correct INTEGER NOT NULL DEFAULT 0,
  decks_played     TEXT NOT NULL DEFAULT '[]'  -- JSON array of deck ids
);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,           -- client uuid, so a retry is idempotent
  device_id     TEXT NOT NULL REFERENCES device(id),
  deck_id       TEXT NOT NULL,
  season_id     TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  ended_at      TEXT NOT NULL,
  answered      INTEGER NOT NULL,
  correct       INTEGER NOT NULL,
  best_streak   INTEGER NOT NULL,
  score         INTEGER NOT NULL,           -- SERVER-computed, never the client's
  claimed_score INTEGER NOT NULL,           -- what the client said, kept for audit
  timings       TEXT NOT NULL,              -- compact JSON, one entry per answer
  -- Null when clean. A flagged session still counts for the learner's own stats
  -- and is only held out of the leaderboard, so a false positive on a genuinely
  -- fast learner costs a leaderboard row rather than their session.
  flags         TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE season (
  id        TEXT PRIMARY KEY,               -- ISO week, e.g. '2026-W39'
  starts_at TEXT NOT NULL,
  ends_at   TEXT NOT NULL
);

-- Rebuilt wholesale by the scheduled handler. Never read with a COUNT.
CREATE TABLE leaderboard_snapshot (
  season_id    TEXT NOT NULL,
  scope        TEXT NOT NULL,               -- 'all-time' | 'week'
  rank         INTEGER NOT NULL,
  device_id    TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_seed  TEXT NOT NULL,
  score        INTEGER NOT NULL,
  best_streak  INTEGER NOT NULL,
  achieved_at  TEXT NOT NULL,
  PRIMARY KEY (season_id, scope, rank)
);

-- ~20 buckets, so approximate rank outside the top 100 is a ~20-row read.
CREATE TABLE score_histogram (
  season_id         TEXT NOT NULL,
  scope             TEXT NOT NULL,
  bucket_min        INTEGER NOT NULL,
  count_at_or_above INTEGER NOT NULL,
  PRIMARY KEY (season_id, scope, bucket_min)
);

CREATE TABLE suggestion (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES device(id),
  payload      TEXT NOT NULL,               -- WordEntry JSON, minus the id
  status       TEXT NOT NULL DEFAULT 'pending',
  moderator_id TEXT,
  decided_at   TEXT,
  reason       TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE badge_award (
  device_id  TEXT NOT NULL REFERENCES device(id),
  badge_id   TEXT NOT NULL,
  -- Empty string rather than NULL for a badge that is not seasonal: NULL is not
  -- comparable in a composite primary key, so a nullable column here would let
  -- the same badge be awarded twice.
  season_id  TEXT NOT NULL DEFAULT '',
  awarded_at TEXT NOT NULL,
  PRIMARY KEY (device_id, badge_id, season_id)
);

CREATE TABLE shared_deck (
  id          TEXT PRIMARY KEY,             -- 8 chars, unambiguous alphabet
  device_id   TEXT NOT NULL REFERENCES device(id),
  name        TEXT NOT NULL,
  entries     TEXT NOT NULL,                -- WordEntry[] JSON
  entry_count INTEGER NOT NULL,
  is_public   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  -- Incremented at most hourly per deck. A popular deck must not spend the
  -- daily write allowance on a counter.
  fetch_count INTEGER NOT NULL DEFAULT 0,
  fetch_counted_at TEXT
);

CREATE TABLE transfer_code (
  code_hash  TEXT PRIMARY KEY,              -- only the hash; the code is shown once
  device_id  TEXT NOT NULL REFERENCES device(id),
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  created_at TEXT NOT NULL
);

-- One row per UTC day. Read by the budget guard, written at most once a minute
-- per Worker instance so the guard cannot become the thing that blows the
-- budget it is guarding.
CREATE TABLE usage (
  day           TEXT PRIMARY KEY,           -- 'YYYY-MM-DD', UTC
  rows_read     INTEGER NOT NULL DEFAULT 0,
  rows_written  INTEGER NOT NULL DEFAULT 0,
  requests      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Every query in the API is served by one of these.
--
-- The two leaderboard indexes are PARTIAL (`WHERE flags IS NULL`) and the week
-- one leads with `season_id`, which is what lets the snapshot builder read a
-- bounded number of rows in index order and stop at its LIMIT. Measured against
-- a local fixture, the alternative — `GROUP BY device_id` with `MAX(score)` to
-- get one row per device, then `ORDER BY` that aggregate to take the top hundred
-- — needs a temp B-tree and therefore a full pass over the season. (The ORDER BY
-- is the part that needs the B-tree; the bare GROUP BY walks idx_session_device.
-- Either way the aggregate is computed for every device before any LIMIT can
-- apply, so the read is linear.)
--
--   sessions in table     bounded read    GROUP BY
--   20,000                3,770 steps     170,378 steps
--   120,000               3,770 steps   1,020,378 steps
--
-- The bounded read is flat; the GROUP BY is linear. At 120k sessions and a
-- 30-minute rebuild that is ~12M rows read per day against a 5M daily cap, so
-- the snapshot builder selects in index order and collapses to one row per
-- device in memory instead. See `worker/src/leaderboard.ts`.
--
-- `idx_session_alltime` exists because the all-time scope does not filter on
-- season, so it cannot use an index that leads with `season_id`. Without it,
-- all-time reports `SCAN session` with a temp B-tree.
CREATE INDEX idx_session_leaderboard ON session (season_id, score DESC) WHERE flags IS NULL;
CREATE INDEX idx_session_alltime     ON session (score DESC)            WHERE flags IS NULL;
-- Not partial: a learner's own history includes their flagged sessions.
CREATE INDEX idx_session_device      ON session (device_id, created_at DESC);
CREATE INDEX idx_suggestion_status   ON suggestion (status, created_at DESC);
CREATE INDEX idx_suggestion_device   ON suggestion (device_id, created_at DESC);
CREATE INDEX idx_transfer_expires    ON transfer_code (expires_at);
CREATE INDEX idx_transfer_device     ON transfer_code (device_id);
CREATE INDEX idx_shared_deck_device  ON shared_deck (device_id, created_at DESC);
CREATE INDEX idx_badge_device        ON badge_award (device_id);
