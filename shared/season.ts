/**
 * Which season a moment belongs to.
 *
 * A season is an ISO week, `2026-W39`, because the weekly leaderboard resets on
 * a Monday and an ISO week is the only week definition both sides can agree on
 * without a timezone argument. Everything here is UTC: a learner in Stockholm
 * and the Worker in whatever datacentre answered have to name the same season
 * for the same session, and local midnight is not a shared fact.
 *
 * `session.season_id` is NOT NULL, which is why this exists at P04 rather than
 * waiting for P05 to build the snapshots that read it.
 */

const DAY_MS = 86_400_000;

/**
 * The ISO week containing `ms`, as `YYYY-Www`.
 *
 * ISO weeks run Monday to Sunday and belong to the year containing their
 * Thursday, which is why the year is read off the Thursday rather than off the
 * date itself. Without that, the days either side of New Year land in a week
 * numbered against the wrong year — 2027-01-01 is a Friday, and it belongs to
 * 2026-W53.
 */
export function seasonIdFor(ms: number): string {
  const date = new Date(ms);
  const thursday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );

  // Sunday is 0 in JavaScript and 7 in ISO 8601.
  const isoDay = thursday.getUTCDay() === 0 ? 7 : thursday.getUTCDay();
  thursday.setUTCDate(thursday.getUTCDate() + 4 - isoDay);

  const year = thursday.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thursday.getTime() - jan1) / DAY_MS + 1) / 7);

  return `${year}-W${String(week).padStart(2, '0')}`;
}
