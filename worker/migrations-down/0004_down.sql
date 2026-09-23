-- Rollback for 0004_badge_days.sql.
--
-- Not in `migrations/`, for the reason given in 0001_down.sql.
ALTER TABLE device DROP COLUMN season_id_days;
ALTER TABLE device DROP COLUMN season_days;

DELETE FROM d1_migrations WHERE name = '0004_badge_days.sql';
