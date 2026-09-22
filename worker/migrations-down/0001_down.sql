-- Rollback for 0001_init.sql.
--
-- Deliberately NOT in `migrations/`: wrangler applies every file in that
-- directory in order, so a down-migration living beside its up-migration is one
-- `migrations apply` away from dropping the schema it just created.
--
-- Run with:
--   npm run db:rollback:staging
--
-- Children before parents, so the REFERENCES clauses do not block the drop on a
-- database with foreign keys enforced.
DROP TABLE IF EXISTS badge_award;
DROP TABLE IF EXISTS transfer_code;
DROP TABLE IF EXISTS shared_deck;
DROP TABLE IF EXISTS suggestion;
DROP TABLE IF EXISTS session;
DROP TABLE IF EXISTS score_histogram;
DROP TABLE IF EXISTS leaderboard_snapshot;
DROP TABLE IF EXISTS season;
DROP TABLE IF EXISTS usage;
DROP TABLE IF EXISTS device;

-- Without this the next `migrations apply` believes 0001 is still applied and
-- recreates nothing, leaving an empty database that looks migrated.
DELETE FROM d1_migrations WHERE name = '0001_init.sql';
