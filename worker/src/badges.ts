/**
 * `top-ten`, the one badge not awarded in `session.ts`.
 *
 * It is seasonal and repeatable — a device can earn it again in a later week,
 * which is why `badge_award.season_id` holds the real week id here instead of
 * `''` — and it depends on a *finalized* week's standings, which only exist
 * once that week's snapshot has been built. Nothing else in this file is like
 * the rest of the badges: it is driven by the cron, not by a session.
 */
import { DAY_MS } from '../../shared/constants';
import { seasonIdFor } from '../../shared/season';
import type { BadgeId } from '../../shared/badges';

export interface BadgeDeps {
  db: D1Database;
  now: number;
}

/**
 * A generous bound on rows read for one device's badge history, not on the
 * number of distinct badges (there are only 9). `top-ten` is the only
 * repeatable badge, one row per week won, so this is years of an unbroken
 * top-10 streak before it would ever bind.
 */
const BADGE_ROWS_MAX = 500;

/**
 * Awards `top-ten` to every device that finished the *previous* ISO week in
 * the weekly top 10.
 *
 * Called on every cron tick, not once at a detected boundary — there is no
 * boundary-detection state to maintain or to get wrong. `seasonIdFor(now -
 * 7*DAY_MS)` always names the week immediately before the current one, since
 * ISO weeks are fixed 7-day blocks, so this never touches the current week's
 * still-moving standings. Re-checking the same finalized week every 30
 * minutes for a full week is cheap — at most 10 reads and 10 idempotent
 * no-op writes — and simpler than tracking "have I already processed this
 * week".
 */
export async function awardTopTen(deps: BadgeDeps): Promise<void> {
  const previousWeek = seasonIdFor(deps.now - 7 * DAY_MS);
  const awardedAt = new Date(deps.now).toISOString();

  const { results } = await deps.db
    .prepare(
      `SELECT device_id FROM leaderboard_snapshot
        WHERE season_id = ? AND scope = 'week' AND rank <= 10
        ORDER BY rank
        LIMIT 10`,
    )
    .bind(previousWeek)
    .all<{ device_id: string }>();

  if (results.length === 0) return;

  const inserts = results.map((row) =>
    deps.db
      .prepare(
        `INSERT INTO badge_award (device_id, badge_id, season_id, awarded_at)
         VALUES (?, 'top-ten', ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(row.device_id, previousWeek, awardedAt),
  );

  await deps.db.batch(inserts);
}

/** Every badge id ever awarded to a device — the badge shelf's source of truth. */
export async function badgesFor(deviceId: string, db: D1Database): Promise<BadgeId[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT badge_id FROM badge_award
        WHERE device_id = ?
        LIMIT ?`,
    )
    .bind(deviceId, BADGE_ROWS_MAX)
    .all<{ badge_id: BadgeId }>();

  return results.map((row) => row.badge_id);
}
