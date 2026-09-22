-- 0002_leaderboard.sql — what the snapshot builder and histogram rank need.
--
-- Three additions, each of which exists to keep a read bounded. 0001 shaped the
-- session write; this shapes the leaderboard read.

-- The device's best *unflagged* session score, maintained in the session
-- handler's existing batch exactly as `best_streak` is.
--
-- This is the input to histogram rank, and it is a column rather than a query
-- because the alternative is `SELECT score FROM session WHERE device_id = ?
-- ORDER BY score DESC LIMIT 1`, which has no index to serve it — `idx_session_device`
-- leads with `created_at`, not `score` — and so grows with the learner's own
-- history. A counter costs nothing: the row is already read by auth.
--
-- Flagged sessions are deliberately excluded from it. They still credit
-- `total_score`, because a flagged session counts for the learner's own stats,
-- but they must never reach anything the leaderboard reads.
ALTER TABLE device ADD COLUMN best_score INTEGER NOT NULL DEFAULT 0;

-- `GET /api/me` asks "is this device in the top 100, and where". The primary key
-- is (season_id, scope, rank), which cannot answer that — a lookup by device_id
-- against it is a 100-row scan. This index makes it one row.
CREATE INDEX idx_snapshot_device ON leaderboard_snapshot (season_id, scope, device_id);

-- When the snapshot was last rebuilt, carried on the histogram rather than in a
-- table of its own.
--
-- The histogram always has at least one row — an empty season writes a single
-- zero bucket — so this is readable even when no session has ever been played,
-- which a `built_at` on `leaderboard_snapshot` would not be. `/api/health`
-- reports it for P14, and the lazy-refresh fallback reads it to decide whether
-- to rebuild inline.
ALTER TABLE score_histogram ADD COLUMN built_at TEXT NOT NULL DEFAULT '';
