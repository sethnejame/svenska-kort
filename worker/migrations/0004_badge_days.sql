-- 0004_badge_days.sql — the one schema gap P09 (badges) has.
--
-- Every other badge is derivable from data the schema already carries
-- (`distinct_correct`, `decks_played` from 0001; `leaderboard_snapshot` from 0002). Only
-- `week-warrior` ("a session on 5 distinct days in one season") needs new state: which season
-- the day-list belongs to, and the list itself. Two columns on `device` rather than a new table,
-- maintained in the session handler's existing batch — the same reasoning as `distinct_correct`
-- and `decks_played` in 0001: a query per submission to derive this would cost more than the
-- badge is worth.
ALTER TABLE device ADD COLUMN season_id_days TEXT NOT NULL DEFAULT '';
ALTER TABLE device ADD COLUMN season_days    TEXT NOT NULL DEFAULT '[]';
