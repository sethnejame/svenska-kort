-- 0003_transfer_rate_limit.sql — the D1-backed counter behind P08's claim
-- limiter, until P13 provides a shared one.
--
-- One row per IP hash, not one row per attempt: an attempt table grows
-- forever and needs a cleanup job that does not exist yet. This follows the
-- `usage` table's shape (0001) instead — a single row that resets itself in
-- place once its window is stale, so the table is bounded by distinct IPs
-- rather than by requests.
CREATE TABLE transfer_claim_attempt (
  ip_hash      TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  attempts     INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
