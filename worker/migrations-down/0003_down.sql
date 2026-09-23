-- Rollback for 0003_transfer_rate_limit.sql.
--
-- Not in `migrations/`, for the reason given in 0001_down.sql.
DROP TABLE IF EXISTS transfer_claim_attempt;

DELETE FROM d1_migrations WHERE name = '0003_transfer_rate_limit.sql';
