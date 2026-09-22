-- Dev-only seed data. Run with `npm run db:seed:local`.
--
-- Deliberately NOT in `migrations/`, and there is deliberately no
-- `db:seed:staging` or `:prod` script: the only thing keeping fixture rows out
-- of a real database should be that no command exists to put them there, not a
-- comment asking the next person to be careful.
--
-- The token hashes below are sha-256 of the literal strings 'dev-token-a' and
-- 'dev-token-b'. They are fixtures for a local SQLite file, not credentials.

INSERT OR REPLACE INTO season (id, starts_at, ends_at) VALUES
  ('2026-W38', '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'),
  ('2026-W39', '2026-09-21T00:00:00.000Z', '2026-09-28T00:00:00.000Z');

INSERT OR REPLACE INTO device
  (id, token_hash, display_name, avatar_seed, is_admin, is_banned,
   created_at, last_seen_at, total_score, best_streak, distinct_correct, decks_played)
VALUES
  ('11111111-1111-4111-8111-111111111111',
   'f4b8a1d6e0c2a9b7d3e5f1c8a4b6d2e0f9c7a5b3d1e8f6c4a2b0d9e7f5c3a1b8',
   'Anna', 'anna-seed', 1, 0,
   '2026-09-01T10:00:00.000Z', '2026-09-22T10:00:00.000Z', 4200, 18, 64, '["vardag","mat"]'),
  ('22222222-2222-4222-8222-222222222222',
   'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
   'Björn', 'bjorn-seed', 0, 0,
   '2026-09-05T10:00:00.000Z', '2026-09-22T09:00:00.000Z', 3100, 11, 41, '["vardag"]'),
  ('33333333-3333-4333-8333-333333333333',
   'deadbeef00000000000000000000000000000000000000000000000000000000',
   'Spärrad', 'banned-seed', 0, 1,
   '2026-09-06T10:00:00.000Z', '2026-09-20T09:00:00.000Z', 99999, 99, 0, '[]');

INSERT OR REPLACE INTO session
  (id, device_id, deck_id, season_id, started_at, ended_at,
   answered, correct, best_streak, score, claimed_score, timings, flags, created_at)
VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'vardag', '2026-W39', '2026-09-22T09:00:00.000Z', '2026-09-22T09:06:00.000Z',
   20, 18, 12, 2400, 2400, '[]', NULL, '2026-09-22T09:06:00.000Z'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'mat', '2026-W39', '2026-09-22T10:00:00.000Z', '2026-09-22T10:05:00.000Z',
   15, 15, 15, 1800, 1800, '[]', NULL, '2026-09-22T10:05:00.000Z'),
  ('bbbbbbbb-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222',
   'vardag', '2026-W39', '2026-09-22T08:00:00.000Z', '2026-09-22T08:07:00.000Z',
   20, 14, 8, 1600, 1600, '[]', NULL, '2026-09-22T08:07:00.000Z'),
  -- A flagged row, so a local leaderboard query that forgets to exclude flagged
  -- sessions is visibly wrong rather than accidentally right.
  ('cccccccc-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'vardag', '2026-W39', '2026-09-20T08:00:00.000Z', '2026-09-20T08:00:30.000Z',
   50, 50, 50, 500, 999999, '[]', '["score-mismatch","fast-rate"]',
   '2026-09-20T08:00:30.000Z');
