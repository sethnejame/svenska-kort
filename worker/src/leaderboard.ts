/**
 * Leaderboard snapshots, the score histogram, and rank.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * Everything in this file exists to avoid one query: `SELECT COUNT(*) FROM
 * session WHERE score > ?`. That reads every row it counts, which caps the
 * leaderboard at roughly fifty requests a day on the free tier — and since
 * Cloudflare began enforcing the D1 daily row limits by failing queries outright,
 * "caps" means the board stops answering, not that it gets slow.
 *
 * So rank is never counted at read time. A scheduled job collapses the season
 * into a hundred snapshot rows and a few dozen histogram buckets, and every read
 * is an indexed lookup against those.
 *
 * The three numbers that matter, all per scope per rebuild:
 *
 *   window read          5,000 rows
 *   snapshot written       100 rows
 *   histogram written    up to 63 rows
 *
 * At two scopes and a thirty-minute cron that is ~480k rows read and ~31k rows
 * written a day, against caps of 5M and 100k. Widening the window is the one
 * change in this file that can take the API down, so `SNAPSHOT_WINDOW` is not a
 * tuning knob; see `HISTOGRAM_BUCKETS` for why the write side is the tighter of
 * the two budgets.
 */
import type { LeaderboardRow, Scope } from '../../shared/api';
import { seasonIdFor } from '../../shared/season';

/**
 * The season id the all-time scope files its snapshot under.
 *
 * Empty string rather than null, for the same reason `badge_award.season_id` uses
 * the trick: this is part of a composite primary key, null is not comparable, and
 * a nullable column here would let the same rank be written twice.
 */
export const ALL_TIME_SEASON = '';

/**
 * How many sessions the builder reads, in score order, per scope.
 *
 * The bound is the whole design. The obvious query — `GROUP BY device_id` with
 * `MAX(score)` for one row per device, ordered by that aggregate so the top
 * hundred can be taken — computes the aggregate for every device in the season
 * before its `LIMIT` can apply, and needs a temp B-tree to order the result:
 * measured at 170,378 steps for 20,000 sessions and 1,020,378 for 120,000. This
 * read is flat at any table size because the partial index is already in score
 * order and the query stops at its `LIMIT`.
 *
 * What it costs: a device is only considered for the board if one of its sessions
 * is in the season's top 5,000. Anyone below that was not going to place in the
 * top hundred, and their rank still comes out of the histogram.
 */
export const SNAPSHOT_WINDOW = 5000;

/** Rows kept per scope. The API's own `limit` is clamped to this. */
export const SNAPSHOT_SIZE = 100;

/**
 * Buckets in the histogram, hence the resolution of an approximate rank.
 *
 * Sixty, because the floors are quantiles rather than even score widths: they sit
 * at the scores of devices at geometrically spaced *ranks* from `SNAPSHOT_SIZE`
 * out to the last device. Consecutive floors are then a fixed *ratio* of ranks
 * apart, and since an approximate rank cannot land outside its own bucket, the
 * relative error is that ratio however the scores are distributed. At 500 devices
 * that ratio is 5^(1/60), about 2.7%.
 *
 * Even-width score floors cannot do this. Scores have a long tail, so the bucket
 * holding the leader holds one device and the bucket above zero holds most of
 * them — and interpolating inside a bucket that wide is out by the width of the
 * bucket, which is the thing being bounded. Twenty even buckets over a realistic
 * distribution missed a true rank of 130 by 18 places.
 *
 * Sixty is also the write budget's ceiling: 63 floors plus 100 snapshot rows,
 * deleted and re-inserted, is ~326 writes per scope, which is ~31k a day at two
 * scopes and a thirty-minute cron against a 100k/day cap. Doubling this halves
 * what is left for the sessions learners actually submit.
 */
export const HISTOGRAM_BUCKETS = 60;

/**
 * How stale a snapshot may be before the lazy path rebuilds it inline.
 *
 * Matched to the cron interval in `wrangler.toml`. A shorter age here than the
 * cron's period would make every lazy-path read find the snapshot stale and
 * rebuild it, which is the read pattern this file exists to avoid.
 */
export const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Snapshot rows per `INSERT`.
 *
 * A statement per row would put 123 statements in one batch; a single statement
 * for all 100 rows would bind 900 parameters against SQLite's 999-variable
 * default. Neither is a limit worth discovering in production, so the insert is
 * chunked: 25 rows is 225 parameters and four statements.
 */
const INSERT_CHUNK = 25;

/** One device's best qualifying session, which is the unit the board ranks. */
export interface DeviceBest {
  deviceId: string;
  displayName: string;
  avatarSeed: string;
  score: number;
  bestStreak: number;
  achievedAt: string;
}

interface WindowRow {
  device_id: string;
  display_name: string;
  avatar_seed: string;
  score: number;
  best_streak: number;
  ended_at: string;
}

export interface HistogramBucket {
  bucket_min: number;
  count_at_or_above: number;
}

export interface LeaderboardDeps {
  db: D1Database;
  now: number;
}

/** The season a scope is filed under at a given moment. */
export function seasonForScope(scope: Scope, now: number): string {
  return scope === 'week' ? seasonIdFor(now) : ALL_TIME_SEASON;
}

/**
 * Best score first, then earliest, then device id.
 *
 * The same order `src/lib/leaderboard.ts` sorts by, because a learner must not
 * see their position change when the board stops being local and starts being
 * remote. A tie going to whoever got there first is the only tiebreak that does
 * not reward playing later.
 */
function better(a: DeviceBest, b: DeviceBest): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.achievedAt !== b.achievedAt) return a.achievedAt < b.achievedAt ? -1 : 1;
  return a.deviceId < b.deviceId ? -1 : 1;
}

/**
 * One row per device, best session each, in board order.
 *
 * The collapse happens here rather than in SQL because that is the difference
 * between a flat read and a linear one. The rows arrive in score order, so the
 * first sighting of a device is already its best — but the comparison is written
 * out anyway, because depending on a query's ordering for correctness means a
 * later `ORDER BY` change silently starts picking the wrong session.
 */
export function collapseToDevices(rows: readonly WindowRow[]): DeviceBest[] {
  const best = new Map<string, DeviceBest>();

  for (const row of rows) {
    const candidate: DeviceBest = {
      deviceId: row.device_id,
      displayName: row.display_name,
      avatarSeed: row.avatar_seed,
      score: row.score,
      bestStreak: row.best_streak,
      achievedAt: row.ended_at,
    };

    const held = best.get(row.device_id);
    if (held === undefined || better(candidate, held) < 0) best.set(row.device_id, candidate);
  }

  return [...best.values()].sort(better);
}

/**
 * The ranks whose scores become histogram floors.
 *
 * Geometric from `SNAPSHOT_SIZE` to the last device, so consecutive floors are a
 * constant *ratio* of ranks apart and the relative error of an interpolated rank
 * is that ratio everywhere rather than tiny at the top and useless in the tail.
 *
 * It starts at `SNAPSHOT_SIZE` because a device inside the top hundred never
 * reaches the histogram — `rankFor` has its exact rank written down — so spending
 * resolution there buys nothing. Rank 1 is included anyway to give the table a
 * top floor at the leader's score, which is what bounds the highest bucket.
 */
function bucketRanks(total: number): number[] {
  const ratio = total / SNAPSHOT_SIZE;
  const ranks = [1];

  for (let i = 0; i <= HISTOGRAM_BUCKETS; i += 1) {
    const rank = Math.round(SNAPSHOT_SIZE * ratio ** (i / HISTOGRAM_BUCKETS));
    // Clamped, so a season smaller than the snapshot collapses to its last rank
    // instead of asking for a device that is not there.
    ranks.push(Math.min(total, Math.max(1, rank)));
  }

  return ranks;
}

/**
 * `count_at_or_above` for the quantile floors, highest floor first.
 *
 * Always includes a zero floor: that row is what a learner below the window is
 * ranked against, so the histogram is never missing the case it exists to answer.
 *
 * Counted with a pass per bucket rather than a single walk with a moving index.
 * That is 62 × 5,000 comparisons at the very worst, which is a fraction of a
 * millisecond and does not register against the scheduled handler's budget, and
 * it avoids the indexed lookup that `noUncheckedIndexedAccess` would make
 * unprovable.
 *
 * `devices` must already be sorted best-first.
 */
export function buildHistogram(devices: readonly DeviceBest[]): HistogramBucket[] {
  const targets = new Set(bucketRanks(devices.length));

  // A Set, because two adjacent target ranks can hold the same score and a
  // repeated floor would collide on the primary key.
  const floors = new Set<number>([0]);

  let rank = 0;
  for (const device of devices) {
    rank += 1;
    if (targets.has(rank)) floors.add(device.score);
  }

  return [...floors]
    .sort((a, b) => b - a)
    .map((min) => ({
      bucket_min: min,
      count_at_or_above: devices.filter((device) => device.score >= min).length,
    }));
}

/** Splits rows into groups small enough to bind in one statement. */
function chunked<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }
  return groups;
}

/**
 * A multi-row `VALUES` list.
 *
 * The SQL is built from the row *count* and a fixed column count, never from any
 * value, so there is nothing here an input can reach.
 */
function valuesList(rows: number, columns: number): string {
  const row = `(${Array(columns).fill('?').join(', ')})`;
  return Array(rows).fill(row).join(', ');
}

/**
 * Rebuilds one scope's snapshot and histogram.
 *
 * One read, then one batch. The deletes and the inserts share a transaction so
 * the board is never briefly empty, and the scope is replaced wholesale rather
 * than merged — a merge would leave a device that dropped out of the top hundred
 * sitting at its old rank forever.
 */
export async function rebuildScope(
  scope: Scope,
  deps: LeaderboardDeps,
): Promise<{ devices: number; ranked: number }> {
  const seasonId = seasonForScope(scope, deps.now);
  const builtAt = new Date(deps.now).toISOString();

  // Two statements rather than one with a conditional season predicate, because
  // each scope has its own partial index — `idx_session_leaderboard` leads with
  // `season_id`, `idx_session_alltime` with `score` — and a combined predicate
  // can use neither.
  const window =
    scope === 'week'
      ? deps.db
          .prepare(
            `SELECT s.device_id, s.score, s.best_streak, s.ended_at,
                    d.display_name, d.avatar_seed
               FROM session s JOIN device d ON d.id = s.device_id
              WHERE s.flags IS NULL AND s.season_id = ?
              ORDER BY s.score DESC
              LIMIT ?`,
          )
          .bind(seasonId, SNAPSHOT_WINDOW)
      : deps.db
          .prepare(
            `SELECT s.device_id, s.score, s.best_streak, s.ended_at,
                    d.display_name, d.avatar_seed
               FROM session s JOIN device d ON d.id = s.device_id
              WHERE s.flags IS NULL
              ORDER BY s.score DESC
              LIMIT ?`,
          )
          .bind(SNAPSHOT_WINDOW);

  const { results } = await window.all<WindowRow>();
  const devices = collapseToDevices(results);
  const ranked = devices.slice(0, SNAPSHOT_SIZE);

  const statements = [
    deps.db
      .prepare('DELETE FROM leaderboard_snapshot WHERE season_id = ? AND scope = ?')
      .bind(seasonId, scope),
    deps.db
      .prepare('DELETE FROM score_histogram WHERE season_id = ? AND scope = ?')
      .bind(seasonId, scope),
  ];

  // Rank is the position in the sorted list, so it is assigned before chunking
  // and carried through; deriving it from the chunk index would restart at 1 in
  // every group.
  for (const group of chunked(ranked.map((device, index) => ({ device, rank: index + 1 })), INSERT_CHUNK)) {
    statements.push(
      deps.db
        .prepare(
          `INSERT INTO leaderboard_snapshot
             (season_id, scope, rank, device_id, display_name, avatar_seed,
              score, best_streak, achieved_at)
           VALUES ${valuesList(group.length, 9)}`,
        )
        .bind(
          ...group.flatMap(({ device, rank }) => [
            seasonId,
            scope,
            rank,
            device.deviceId,
            device.displayName,
            device.avatarSeed,
            device.score,
            device.bestStreak,
            device.achievedAt,
          ]),
        ),
    );
  }

  const buckets = buildHistogram(devices);
  statements.push(
    deps.db
      .prepare(
        `INSERT INTO score_histogram
           (season_id, scope, bucket_min, count_at_or_above, built_at)
         VALUES ${valuesList(buckets.length, 5)}`,
      )
      .bind(
        ...buckets.flatMap((bucket) => [
          seasonId,
          scope,
          bucket.bucket_min,
          bucket.count_at_or_above,
          builtAt,
        ]),
      ),
  );

  await deps.db.batch(statements);
  return { devices: devices.length, ranked: ranked.length };
}

/** Both scopes. The cron's whole body. */
export async function rebuildAll(deps: LeaderboardDeps): Promise<void> {
  await rebuildScope('all-time', deps);
  await rebuildScope('week', deps);
}

/**
 * The top `limit` rows of a scope.
 *
 * `isMe` is not here and is not stored: the board is shared by every caller and
 * cached as one body, so a per-caller field cannot be baked into it. The client
 * marks its own row by `deviceId`.
 */
export async function topRows(
  scope: Scope,
  limit: number,
  deps: LeaderboardDeps,
): Promise<LeaderboardRow[]> {
  const { results } = await deps.db
    .prepare(
      `SELECT rank, device_id, display_name, avatar_seed, score, best_streak, achieved_at
         FROM leaderboard_snapshot
        WHERE season_id = ? AND scope = ?
        ORDER BY rank
        LIMIT ?`,
    )
    .bind(seasonForScope(scope, deps.now), scope, Math.min(limit, SNAPSHOT_SIZE))
    .all<{
      rank: number;
      device_id: string;
      display_name: string;
      avatar_seed: string;
      score: number;
      best_streak: number;
      achieved_at: string;
    }>();

  return results.map((row) => ({
    rank: row.rank,
    deviceId: row.device_id,
    displayName: row.display_name,
    avatarSeed: row.avatar_seed,
    score: row.score,
    bestStreak: row.best_streak,
    achievedAt: row.achieved_at,
  }));
}

/**
 * Where a score sits: exactly inside the top hundred, approximately outside it.
 *
 * Two reads, at most 64 rows total, at any table size:
 *
 *   1. The snapshot, by device. A device in the top hundred has its exact rank
 *      written down already, so there is nothing to estimate.
 *   2. The histogram, otherwise.
 *
 * Returns null for a device with no qualifying score. Null rather than zero and
 * rather than `devices + 1`: "not placed" and "last" are different facts, and a
 * learner whose only sessions were flagged must not be shown a position that
 * implies the board knows about them.
 */
export async function rankFor(
  deviceId: string,
  score: number,
  scope: Scope,
  deps: LeaderboardDeps,
): Promise<number | null> {
  const seasonId = seasonForScope(scope, deps.now);

  const exact = await deps.db
    .prepare(
      `SELECT rank FROM leaderboard_snapshot
        WHERE season_id = ? AND scope = ? AND device_id = ?
        LIMIT 1`,
    )
    .bind(seasonId, scope, deviceId)
    .first<{ rank: number }>();

  if (exact !== null) return exact.rank;

  // Asking the histogram where zero sits would answer "behind everybody" rather
  // than "nowhere", and a device that has never scored has not placed.
  if (score <= 0) return null;

  const { results: buckets } = await deps.db
    .prepare(
      `SELECT bucket_min, count_at_or_above FROM score_histogram
        WHERE season_id = ? AND scope = ?
        ORDER BY bucket_min DESC
        LIMIT ?`,
    )
    // `HISTOGRAM_BUCKETS` floors, plus the leader's and the zero floor.
    .bind(seasonId, scope, HISTOGRAM_BUCKETS + 3)
    .all<HistogramBucket>();

  return interpolateRank(score, buckets);
}

/**
 * Rank from the histogram, interpolated within the bucket the score falls in.
 *
 * `buckets` is ordered by floor, descending. `count_at_or_above` only grows as
 * the floor drops, so the two floors either side of the score bound how many
 * devices are ahead of it — and because the floors are quantiles, those two bounds
 * are a couple of percent of ranks apart, which is what makes the answer useful
 * at all. Reading linearly inside the bucket then picks a position within that
 * span rather than reporting one of its ends.
 */
export function interpolateRank(
  score: number,
  buckets: readonly HistogramBucket[],
): number | null {
  const [highest] = buckets;
  // Nothing has been built, so there is no board to have a position on.
  if (highest === undefined) return null;

  // Floors descend, so the first one at or below the score is its lower bound and
  // the one before that is its upper bound.
  let above = highest;
  let below: HistogramBucket | undefined;
  for (const bucket of buckets) {
    if (bucket.bucket_min <= score) {
      below = bucket;
      break;
    }
    above = bucket;
  }

  // No floor at or below the score. Zero is always a floor, so this is a negative
  // score — nonsense that belongs nowhere on the board.
  if (below === undefined) return null;

  // At or above the highest floor in the table. The count there already includes
  // this device, so it is the rank rather than the number of devices ahead of it.
  if (below === above) return Math.max(1, below.count_at_or_above);

  const span = above.bucket_min - below.bucket_min;
  // Everything at or above the upper floor is strictly ahead of this score.
  const ahead = above.count_at_or_above;
  const withinBucket = below.count_at_or_above - ahead;

  // 0 at the bucket's floor, 1 at its ceiling. The share of the bucket above the
  // score is assumed to hold the same share of the bucket's devices.
  const position = (score - below.bucket_min) / span;
  return Math.round(ahead + withinBucket * (1 - position)) + 1;
}

/**
 * How long ago this scope's snapshot was built, in seconds, or null if never.
 *
 * Read off the histogram because the histogram always has a row — an empty season
 * still writes its zero bucket — where an empty `leaderboard_snapshot` would
 * leave "never built" and "built, nobody played" indistinguishable.
 */
export async function snapshotAgeSeconds(
  scope: Scope,
  deps: LeaderboardDeps,
): Promise<number | null> {
  const row = await deps.db
    .prepare(
      `SELECT built_at FROM score_histogram
        WHERE season_id = ? AND scope = ?
        ORDER BY bucket_min
        LIMIT 1`,
    )
    .bind(seasonForScope(scope, deps.now), scope)
    .first<{ built_at: string }>();

  if (row === null) return null;

  const builtAt = Date.parse(row.built_at);
  if (Number.isNaN(builtAt)) return null;

  // Clamped at zero: a snapshot written by a Worker whose clock ran ahead would
  // otherwise report a negative age, and "fresher than now" is not something the
  // health check should ever have to describe.
  return Math.max(0, Math.round((deps.now - builtAt) / 1000));
}
