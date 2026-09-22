-- Rollback for 0002_leaderboard.sql.
--
-- Not in `migrations/`, for the reason given in 0001_down.sql.
--
-- SQLite has supported `DROP COLUMN` since 3.35 and D1 is well past that, so
-- these are real drops rather than a table rebuild. The snapshot and histogram
-- contents are derived data: dropping `built_at` loses nothing a rebuild does
-- not immediately restore.
DROP INDEX IF EXISTS idx_snapshot_device;
ALTER TABLE score_histogram DROP COLUMN built_at;
ALTER TABLE device DROP COLUMN best_score;

DELETE FROM d1_migrations WHERE name = '0002_leaderboard.sql';
