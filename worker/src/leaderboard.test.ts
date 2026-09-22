import { beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_TIME_SEASON,
  buildHistogram,
  collapseToDevices,
  HISTOGRAM_BUCKETS,
  interpolateRank,
  rankFor,
  rebuildAll,
  rebuildScope,
  seasonForScope,
  snapshotAgeSeconds,
  SNAPSHOT_SIZE,
  SNAPSHOT_WINDOW,
  topRows,
  type DeviceBest,
  type HistogramBucket,
} from './leaderboard';
import { seasonIdFor } from '../../shared/season';
import { TestD1 } from '../test/d1';

/** A Thursday in ISO week 2026-W39, so the week scope has a stable season. */
const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const SEASON = seasonIdFor(NOW);

let db: TestD1;

function deps(now = NOW) {
  return { db: db as unknown as D1Database, now };
}

function device(id: string, name = `Namn ${id}`) {
  db.seed(
    `INSERT INTO device (id, token_hash, display_name, avatar_seed, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    `hash-${id}`,
    name,
    `seed-${id}`,
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  );
}

let sessionCounter = 0;

function session(
  deviceId: string,
  score: number,
  options: { seasonId?: string; flags?: string | null; endedAt?: string } = {},
) {
  sessionCounter += 1;
  const endedAt = options.endedAt ?? `2026-09-24T10:${String(sessionCounter % 60).padStart(2, '0')}:00.000Z`;
  db.seed(
    `INSERT INTO session (id, device_id, deck_id, season_id, started_at, ended_at,
                          answered, correct, best_streak, score, claimed_score,
                          timings, flags, created_at)
     VALUES (?, ?, 'grund', ?, ?, ?, 10, 10, 5, ?, ?, '[]', ?, ?)`,
    `s-${sessionCounter}`,
    deviceId,
    options.seasonId ?? SEASON,
    endedAt,
    endedAt,
    score,
    score,
    options.flags ?? null,
    endedAt,
  );
}

beforeEach(() => {
  db = new TestD1();
  sessionCounter = 0;
});

describe('seasonForScope', () => {
  it('files the week scope under the ISO week and all-time under the sentinel', () => {
    expect(seasonForScope('week', NOW)).toBe('2026-W39');
    expect(seasonForScope('all-time', NOW)).toBe(ALL_TIME_SEASON);
  });

  it('uses the empty string for all-time, not null', () => {
    // Null is not comparable inside a composite primary key, so a nullable
    // season would let the same rank be inserted twice.
    expect(ALL_TIME_SEASON).toBe('');
  });
});

describe('collapseToDevices', () => {
  const row = (deviceId: string, score: number, endedAt: string) => ({
    device_id: deviceId,
    display_name: deviceId,
    avatar_seed: deviceId,
    score,
    best_streak: 1,
    ended_at: endedAt,
  });

  it('keeps one row per device, its best', () => {
    const collapsed = collapseToDevices([
      row('a', 300, '2026-09-24T10:00:00.000Z'),
      row('a', 100, '2026-09-24T11:00:00.000Z'),
      row('b', 200, '2026-09-24T10:00:00.000Z'),
    ]);

    expect(collapsed.map((d) => [d.deviceId, d.score])).toEqual([
      ['a', 300],
      ['b', 200],
    ]);
  });

  it('picks the better session even when the rows arrive worst-first', () => {
    // The real query returns score-descending, so this ordering cannot happen —
    // which is exactly why it is tested. The collapse must not be relying on it.
    const collapsed = collapseToDevices([
      row('a', 10, '2026-09-24T10:00:00.000Z'),
      row('a', 900, '2026-09-24T11:00:00.000Z'),
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.score).toBe(900);
  });

  it('breaks a score tie in favour of whoever got there first', () => {
    const collapsed = collapseToDevices([
      row('late', 500, '2026-09-24T18:00:00.000Z'),
      row('early', 500, '2026-09-24T09:00:00.000Z'),
    ]);

    expect(collapsed.map((d) => d.deviceId)).toEqual(['early', 'late']);
  });

  it('breaks that tie the same way whichever order the rows arrive in', () => {
    // The pair above, swapped. A comparator that is right in one direction and
    // wrong in the other sorts correctly only by luck of the input order.
    const collapsed = collapseToDevices([
      row('early', 500, '2026-09-24T09:00:00.000Z'),
      row('late', 500, '2026-09-24T18:00:00.000Z'),
    ]);

    expect(collapsed.map((d) => d.deviceId)).toEqual(['early', 'late']);
  });

  it('breaks an exact tie by device id, so the order is never arbitrary', () => {
    const at = '2026-09-24T09:00:00.000Z';
    const collapsed = collapseToDevices([row('b', 500, at), row('a', 500, at)]);
    expect(collapsed.map((d) => d.deviceId)).toEqual(['a', 'b']);
  });

  it('collapses nothing when there is nothing', () => {
    expect(collapseToDevices([])).toEqual([]);
  });
});

describe('buildHistogram', () => {
  const best = (score: number): DeviceBest => ({
    deviceId: `d-${score}`,
    displayName: 'x',
    avatarSeed: 'x',
    score,
    bestStreak: 1,
    achievedAt: '2026-09-24T10:00:00.000Z',
  });

  it('always ends at a zero floor, so a low score has something to rank against', () => {
    const buckets = buildHistogram([best(1000), best(500)]);
    expect(buckets.at(-1)?.bucket_min).toBe(0);
    expect(buckets.at(-1)?.count_at_or_above).toBe(2);
  });

  /** A long tail: a handful of high scores, most of them low. */
  const tail = (count: number): DeviceBest[] =>
    Array.from({ length: count }, (_, i) => best(Math.ceil(10_000 / (i + 1))));

  it('puts its top floor at the leader score, so the highest bucket is bounded', () => {
    expect(buildHistogram(tail(400))[0]?.bucket_min).toBe(10_000);
  });

  it('spends its floors below the top hundred, where rank is not already exact', () => {
    const devices = tail(400);
    const hundredth = devices[SNAPSHOT_SIZE - 1]?.score ?? 0;
    const floors = buildHistogram(devices).map((b) => b.bucket_min);

    // Only the leader's. A device inside the top hundred has its exact rank in
    // the snapshot and never reaches the histogram, so resolution up there is
    // resolution spent on nobody.
    expect(floors.filter((floor) => floor > hundredth)).toEqual([10_000]);
  });

  it('counts at or above each floor, never below', () => {
    const devices = tail(400);

    for (const { bucket_min, count_at_or_above } of buildHistogram(devices)) {
      const truth = devices.filter((device) => device.score >= bucket_min).length;
      expect(count_at_or_above, `floor ${bucket_min}`).toBe(truth);
    }
  });

  it('never decreases as the floor drops', () => {
    const buckets = buildHistogram([best(970), best(640), best(210), best(15)]);
    const counts = buckets.map((b) => b.count_at_or_above);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('stays inside the row budget the rebuild is allowed', () => {
    // The read in `rankFor` asks for this many and no more, so a histogram wider
    // than its own limit would silently lose its lowest floors.
    expect(buildHistogram(tail(5000)).length).toBeLessThanOrEqual(HISTOGRAM_BUCKETS + 3);
  });

  it('collapses duplicate floors rather than colliding on the primary key', () => {
    // Every target rank lands on the same score, so every floor is the same one.
    const buckets = buildHistogram(Array.from({ length: 300 }, () => best(7)));
    expect(buckets.map((b) => b.bucket_min)).toEqual([7, 0]);
  });

  it('produces a single zero bucket for an empty season', () => {
    // Not an empty array: the histogram is where snapshot age is read from, and
    // "never built" has to stay distinguishable from "built, nobody played".
    expect(buildHistogram([])).toEqual([{ bucket_min: 0, count_at_or_above: 0 }]);
  });
});

describe('interpolateRank', () => {
  const bucket = (min: number, count: number): HistogramBucket => ({
    bucket_min: min,
    count_at_or_above: count,
  });

  it('has no answer when nothing has been built', () => {
    expect(interpolateRank(500, [])).toBeNull();
  });

  it('reads the count at the top floor as the rank when the score is above it', () => {
    // Ten devices at or above 1000, and this score is one of them.
    expect(interpolateRank(1200, [bucket(1000, 10), bucket(0, 50)])).toBe(10);
  });

  it('never returns a rank below one', () => {
    expect(interpolateRank(1200, [bucket(1000, 0), bucket(0, 0)])).toBe(1);
  });

  it('interpolates across the bucket rather than reporting its floor', () => {
    // 100 devices at or above 500, 200 at or above 400: 100 devices in the
    // bucket. Halfway up it, half of them are ahead.
    const buckets = [bucket(500, 100), bucket(400, 200), bucket(0, 900)];
    expect(interpolateRank(450, buckets)).toBe(151);
  });

  it('interpolates in the right direction', () => {
    // Deliberately off-centre. A midpoint score cannot tell a reading of the
    // bucket from below apart from one from above, because both give the same
    // answer there — three quarters of the way up, they differ by fifty places.
    const buckets = [bucket(500, 100), bucket(400, 200), bucket(0, 900)];
    expect(interpolateRank(475, buckets)).toBe(126);
    expect(interpolateRank(425, buckets)).toBe(176);
  });

  it('lands on the upper bound at the top of a bucket and the lower at the bottom', () => {
    const buckets = [bucket(500, 100), bucket(400, 200), bucket(0, 900)];
    expect(interpolateRank(500, buckets)).toBe(100);
    expect(interpolateRank(400, buckets)).toBe(201);
  });

  it('refuses a negative score rather than placing it last', () => {
    expect(interpolateRank(-50, [bucket(1000, 10), bucket(0, 50)])).toBeNull();
  });

  it('handles a histogram of one bucket', () => {
    expect(interpolateRank(10, [bucket(0, 4)])).toBe(4);
  });
});

describe('rebuildScope', () => {
  it('writes one snapshot row per device, its best session', async () => {
    device('alice');
    for (const score of [100, 900, 400]) session('alice', score);
    device('bob');
    session('bob', 500);

    await rebuildScope('all-time', deps());

    const rows = db.read<{ rank: number; device_id: string; score: number }>(
      'SELECT rank, device_id, score FROM leaderboard_snapshot ORDER BY rank',
    );
    expect(rows).toEqual([
      { rank: 1, device_id: 'alice', score: 900 },
      { rank: 2, device_id: 'bob', score: 500 },
    ]);
  });

  it('gives one device with fifty sessions exactly one row', async () => {
    device('grinder');
    for (let i = 1; i <= 50; i += 1) session('grinder', i * 10);

    await rebuildScope('all-time', deps());

    const rows = db.read('SELECT rank, score FROM leaderboard_snapshot');
    expect(rows).toEqual([{ rank: 1, score: 500 }]);
  });

  it('never lets a flagged session into a snapshot', async () => {
    device('honest');
    session('honest', 100);
    device('flagged');
    session('flagged', 100_000, { flags: '["fast-rate"]' });

    await rebuildScope('all-time', deps());

    const rows = db.read<{ device_id: string }>('SELECT device_id FROM leaderboard_snapshot');
    expect(rows).toEqual([{ device_id: 'honest' }]);
  });

  it('leaves a device out entirely when every session it has is flagged', async () => {
    device('only-flagged');
    session('only-flagged', 900, { flags: '["score-mismatch"]' });
    session('only-flagged', 800, { flags: '["impossible-timing"]' });

    await rebuildScope('all-time', deps());

    expect(db.read('SELECT * FROM leaderboard_snapshot')).toEqual([]);
    // But the histogram is still written, so age stays readable.
    expect(db.read('SELECT * FROM score_histogram')).toHaveLength(1);
  });

  it('keeps the board at the snapshot size however many devices there are', async () => {
    for (let i = 0; i < SNAPSHOT_SIZE + 25; i += 1) {
      device(`d${String(i).padStart(3, '0')}`);
      session(`d${String(i).padStart(3, '0')}`, 10_000 - i);
    }

    const { devices, ranked } = await rebuildScope('all-time', deps());

    expect(devices).toBe(SNAPSHOT_SIZE + 25);
    expect(ranked).toBe(SNAPSHOT_SIZE);
    expect(db.read('SELECT * FROM leaderboard_snapshot')).toHaveLength(SNAPSHOT_SIZE);
  });

  it('ranks consecutively from one across the chunk boundary', async () => {
    // The insert is chunked at 25 rows, so a rank derived from the position
    // within a chunk would restart at 1 four times over.
    for (let i = 0; i < SNAPSHOT_SIZE; i += 1) {
      device(`d${String(i).padStart(3, '0')}`);
      session(`d${String(i).padStart(3, '0')}`, 10_000 - i);
    }

    await rebuildScope('all-time', deps());

    const ranks = db
      .read<{ rank: number }>('SELECT rank FROM leaderboard_snapshot ORDER BY rank')
      .map((row) => row.rank);
    expect(ranks).toEqual(Array.from({ length: SNAPSHOT_SIZE }, (_, i) => i + 1));
  });

  it('replaces the scope rather than merging, so a fallen device loses its rank', async () => {
    device('was-first');
    session('was-first', 900);
    await rebuildScope('all-time', deps());
    expect(db.read('SELECT * FROM leaderboard_snapshot')).toHaveLength(1);

    db.seed('DELETE FROM session');
    device('new-only');
    session('new-only', 100);
    await rebuildScope('all-time', deps());

    const rows = db.read<{ device_id: string }>('SELECT device_id FROM leaderboard_snapshot');
    expect(rows).toEqual([{ device_id: 'new-only' }]);
  });

  it('reads a bounded number of rows however large the table is', async () => {
    device('one');
    for (let i = 0; i < 40; i += 1) session('one', i);

    db.resetCounters();
    await rebuildScope('all-time', deps());

    // The window is the only read, and it cannot exceed its LIMIT.
    expect(db.rowsRead).toBeLessThanOrEqual(SNAPSHOT_WINDOW);
  });

  it('puts the whole rebuild in one batch, so the board is never briefly empty', async () => {
    device('a');
    session('a', 100);
    await rebuildScope('all-time', deps());

    db.resetCounters();
    await rebuildScope('all-time', deps());

    // Two deletes, one snapshot insert, one histogram insert. A statement per
    // row would be 123 in a batch that has to stay inside D1's limits.
    const writes = db.queries.filter((query) => query.rowsWritten > 0 || /delete/i.test(query.sql));
    expect(writes.length).toBeLessThanOrEqual(8);
  });
});

describe('seasons', () => {
  it('scopes the week to the current ISO week and ignores other seasons', async () => {
    device('this-week');
    session('this-week', 100, { seasonId: SEASON });
    device('last-week');
    session('last-week', 9000, { seasonId: '2026-W38' });

    await rebuildScope('week', deps());

    const rows = db.read<{ device_id: string }>(
      'SELECT device_id FROM leaderboard_snapshot WHERE scope = ?',
      'week',
    );
    expect(rows).toEqual([{ device_id: 'this-week' }]);
  });

  it('counts every season in the all-time scope', async () => {
    device('old');
    session('old', 9000, { seasonId: '2026-W38' });

    await rebuildScope('all-time', deps());

    expect(db.read('SELECT * FROM leaderboard_snapshot')).toHaveLength(1);
  });

  it('moves the week scope to a new season at the boundary without touching all-time', async () => {
    device('player');
    session('player', 700, { seasonId: SEASON });
    await rebuildAll(deps());

    expect(await topRows('week', 50, deps())).toHaveLength(1);
    expect(await topRows('all-time', 50, deps())).toHaveLength(1);

    // One week on. Nothing was deleted; the week scope simply asks a different
    // season, which nobody has played yet.
    const nextWeek = NOW + 7 * 86_400_000;
    expect(seasonIdFor(nextWeek)).not.toBe(SEASON);

    expect(await topRows('week', 50, deps(nextWeek))).toEqual([]);
    // All-time is untouched by the rollover, and last week's rows are still there.
    expect(await topRows('all-time', 50, deps(nextWeek))).toHaveLength(1);
    expect(
      db.read('SELECT * FROM leaderboard_snapshot WHERE season_id = ?', SEASON),
    ).toHaveLength(1);
  });

  it('rebuilds both scopes', async () => {
    device('a');
    session('a', 100);

    await rebuildAll(deps());

    const scopes = db.read<{ scope: string }>(
      'SELECT DISTINCT scope FROM leaderboard_snapshot ORDER BY scope',
    );
    expect(scopes).toEqual([{ scope: 'all-time' }, { scope: 'week' }]);
  });
});

describe('topRows', () => {
  it('reads no more rows than the limit asks for', async () => {
    for (let i = 0; i < 60; i += 1) {
      device(`d${String(i).padStart(3, '0')}`);
      session(`d${String(i).padStart(3, '0')}`, 1000 - i);
    }
    await rebuildScope('all-time', deps());

    db.resetCounters();
    const rows = await topRows('all-time', 50, deps());

    expect(rows).toHaveLength(50);
    expect(db.rowsRead).toBe(50);
  });

  it('clamps a limit above the snapshot size', async () => {
    device('a');
    session('a', 10);
    await rebuildScope('all-time', deps());

    // Nothing is stored beyond the snapshot size, so this cannot over-read.
    expect(await topRows('all-time', 100, deps())).toHaveLength(1);
  });

  it('carries the fields the board renders and the device id the client marks itself with', async () => {
    device('me', 'Sven');
    session('me', 640, { endedAt: '2026-09-24T10:30:00.000Z' });
    await rebuildScope('all-time', deps());

    expect(await topRows('all-time', 50, deps())).toEqual([
      {
        rank: 1,
        deviceId: 'me',
        displayName: 'Sven',
        avatarSeed: 'seed-me',
        score: 640,
        bestStreak: 5,
        achievedAt: '2026-09-24T10:30:00.000Z',
      },
    ]);
  });

  it('is empty before anything has been built', async () => {
    expect(await topRows('all-time', 50, deps())).toEqual([]);
  });
});

describe('rankFor', () => {
  it('is exact for a device inside the snapshot', async () => {
    for (let i = 0; i < 10; i += 1) {
      device(`d${i}`);
      session(`d${i}`, 1000 - i * 10);
    }
    await rebuildScope('all-time', deps());

    expect(await rankFor('d0', 1000, 'all-time', deps())).toBe(1);
    expect(await rankFor('d7', 930, 'all-time', deps())).toBe(8);
  });

  it('costs a bounded number of rows for a device outside the snapshot', async () => {
    for (let i = 0; i < SNAPSHOT_SIZE + 50; i += 1) {
      device(`d${String(i).padStart(3, '0')}`);
      session(`d${String(i).padStart(3, '0')}`, 10_000 - i * 10);
    }
    await rebuildScope('all-time', deps());

    db.resetCounters();
    await rankFor('d149', 8510, 'all-time', deps());

    // One snapshot miss plus the histogram. The ticket's budget is 70.
    expect(db.rowsRead).toBeLessThanOrEqual(70);
  });

  it('has no rank for a device that has never scored', async () => {
    device('newcomer');
    await rebuildScope('all-time', deps());

    // Null, not zero and not last: "has not placed" is its own fact.
    expect(await rankFor('newcomer', 0, 'all-time', deps())).toBeNull();
  });

  it('has no rank for a device whose only sessions were flagged', async () => {
    device('flagged');
    session('flagged', 5000, { flags: '["fast-rate"]' });
    await rebuildScope('all-time', deps());

    // `best_score` is never credited for a flagged session, so the score here is
    // zero however well the session scored.
    expect(await rankFor('flagged', 0, 'all-time', deps())).toBeNull();
  });

  it('has no rank before a snapshot exists', async () => {
    device('early');
    expect(await rankFor('early', 500, 'all-time', deps())).toBeNull();
  });
});

/**
 * The accuracy claim, against a fixture big enough for the approximation to be
 * wrong in a way that shows.
 *
 * 500 devices and 10,000 sessions, seeded from a deterministic generator so a
 * failure is reproducible rather than a flake. Scores are spread unevenly on
 * purpose: a uniform distribution would make linear interpolation look better
 * than it is, and the real shape of a leaderboard is a long tail.
 */
describe('rank accuracy against 10,000 sessions', () => {
  const DEVICES = 500;
  const SESSIONS = 10_000;

  /** A tiny LCG. Deterministic, seeded, and good enough to spread scores. */
  function generator(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  }

  let truth: { deviceId: string; score: number }[];

  beforeEach(async () => {
    const random = generator(20_260_924);
    const best = new Map<string, number>();

    const rows: string[] = [];
    for (let i = 0; i < SESSIONS; i += 1) {
      const deviceId = `d${String(Math.floor(random() * DEVICES)).padStart(3, '0')}`;
      // Squared, so most scores are low and a few are very high.
      const score = Math.floor(random() ** 2 * 3000) + 1;
      rows.push(`('s${i}','${deviceId}','grund','${SEASON}','x','x',10,10,5,${score},${score},'[]',NULL,'x')`);
      best.set(deviceId, Math.max(best.get(deviceId) ?? 0, score));
    }

    for (let i = 0; i < DEVICES; i += 1) device(`d${String(i).padStart(3, '0')}`);
    // One statement: 10,000 prepared inserts is slower than the test is worth,
    // and this is fixture setup rather than anything the Worker does.
    db.seed(
      `INSERT INTO session (id, device_id, deck_id, season_id, started_at, ended_at,
                            answered, correct, best_streak, score, claimed_score,
                            timings, flags, created_at) VALUES ${rows.join(',')}`,
    );

    // The exact answer, computed outside the code under test.
    truth = [...best.entries()]
      .map(([deviceId, score]) => ({ deviceId, score }))
      .sort((a, b) => b.score - a.score || (a.deviceId < b.deviceId ? -1 : 1));

    await rebuildScope('all-time', deps());
  });

  it('seeds a fixture with a device count worth approximating over', () => {
    expect(truth.length).toBeGreaterThan(SNAPSHOT_SIZE * 3);
  });

  it('is exact for every device inside the top 100', async () => {
    for (const [index, entry] of truth.slice(0, SNAPSHOT_SIZE).entries()) {
      expect(await rankFor(entry.deviceId, entry.score, 'all-time', deps())).toBe(index + 1);
    }
  });

  it('is within 5% for every device outside the top 100', async () => {
    const errors: { rank: number; got: number; error: number }[] = [];

    for (const [index, entry] of truth.entries()) {
      if (index < SNAPSHOT_SIZE) continue;
      const actual = index + 1;
      const got = await rankFor(entry.deviceId, entry.score, 'all-time', deps());
      expect(got).not.toBeNull();
      errors.push({ rank: actual, got: got ?? 0, error: Math.abs((got ?? 0) - actual) / actual });
    }

    const worst = errors.reduce((a, b) => (a.error > b.error ? a : b));
    expect(worst.error, `worst: rank ${worst.rank} reported as ${worst.got}`).toBeLessThanOrEqual(
      0.05,
    );
  });

  it('costs the same bounded read at 10,000 sessions as at ten', async () => {
    db.resetCounters();
    await rankFor('d499', truth[truth.length - 1]?.score ?? 1, 'all-time', deps());

    expect(db.rowsRead).toBeLessThanOrEqual(70);
  });

  it('never reads more than the window during a rebuild of a 10,000-session table', async () => {
    db.resetCounters();
    await rebuildScope('all-time', deps());

    expect(db.rowsRead).toBeLessThanOrEqual(SNAPSHOT_WINDOW);
  });
});

/**
 * The daily-budget claim, at the table size where the naive design fails.
 *
 * 100,000 sessions is roughly a year of a busy week for an app this size, and it
 * is the size at which `COUNT(*)` for rank or a `GROUP BY` for the board stops
 * being slow and starts returning errors: since 2026-09-01 Cloudflare fails D1
 * queries outright once a day's row limits are gone.
 *
 * So the assertion is not "fast enough". It is that a full day of crons plus a
 * rank read stays inside the free tier's 5M reads and 100k writes, at a table
 * size that makes any linear query impossible.
 */
describe('the day budget at 100,000 sessions', () => {
  const SESSIONS = 100_000;
  const DEVICES = 2000;
  /** The thirty-minute cron in `wrangler.toml`, expressed as runs a day. */
  const RUNS_PER_DAY = 48;

  beforeEach(() => {
    for (let i = 0; i < DEVICES; i += 1) device(`d${String(i).padStart(4, '0')}`);

    // Seeded in chunks of 5,000 rather than row by row: 100,000 prepared inserts
    // is minutes, and this is fixture setup rather than anything the Worker runs.
    for (let start = 0; start < SESSIONS; start += 5000) {
      const rows: string[] = [];
      for (let i = start; i < start + 5000; i += 1) {
        const deviceId = `d${String(i % DEVICES).padStart(4, '0')}`;
        const score = ((i * 2654435761) % 30_000) + 1;
        rows.push(
          `('s${i}','${deviceId}','grund','${SEASON}','x','x',10,10,5,${score},${score},'[]',NULL,'x')`,
        );
      }
      db.seed(
        `INSERT INTO session (id, device_id, deck_id, season_id, started_at, ended_at,
                              answered, correct, best_streak, score, claimed_score,
                              timings, flags, created_at) VALUES ${rows.join(',')}`,
      );
    }
  });

  it('keeps a day of rebuilds inside the daily read and write caps', async () => {
    db.resetCounters();
    await rebuildAll(deps());

    // Both scopes, so this is the cost of one cron firing.
    expect(db.rowsRead * RUNS_PER_DAY).toBeLessThanOrEqual(5_000_000);
    expect(db.rowsWritten * RUNS_PER_DAY).toBeLessThanOrEqual(100_000);
  });

  it('leaves most of the write budget for the sessions learners submit', async () => {
    db.resetCounters();
    await rebuildAll(deps());

    // Two rows per submitted session, per P04. The board must not be the reason a
    // learner's session fails to save, so the cron gets a minority of the day.
    const perDay = db.rowsWritten * RUNS_PER_DAY;
    expect((100_000 - perDay) / 2).toBeGreaterThan(30_000);
  });

  it('costs the same bounded rank read here as at ten sessions', async () => {
    await rebuildScope('all-time', deps());

    db.resetCounters();
    // A score below the window, which is the case that reaches the histogram.
    expect(await rankFor('d1999', 5, 'all-time', deps())).not.toBeNull();

    expect(db.rowsRead).toBeLessThanOrEqual(70);
  });
});

/**
 * The `EXPLAIN QUERY PLAN` gate from CLAUDE.md, asserted rather than eyeballed.
 *
 * A plan pasted into a PR description rots the moment a query changes; this fails
 * the build instead. The one permitted `SCAN` is the all-time window, which walks
 * `idx_session_alltime` in score order and stops at its `LIMIT` — the exception
 * already documented in the README, and it is pinned here so it cannot quietly
 * become a second one.
 */
describe('query plans', () => {
  const WINDOW_COLUMNS = `s.device_id, s.score, s.best_streak, s.ended_at, d.display_name, d.avatar_seed`;

  it('serves the week window from the partial season index with no temp b-tree', () => {
    const plan = db.explain(
      `SELECT ${WINDOW_COLUMNS} FROM session s JOIN device d ON d.id = s.device_id
        WHERE s.flags IS NULL AND s.season_id = ? ORDER BY s.score DESC LIMIT ?`,
      SEASON,
      SNAPSHOT_WINDOW,
    );

    expect(plan.join('\n')).toContain('idx_session_leaderboard');
    expect(plan.join('\n')).not.toContain('TEMP B-TREE');
  });

  it('serves the all-time window from its own index in score order, with no temp b-tree', () => {
    const plan = db.explain(
      `SELECT ${WINDOW_COLUMNS} FROM session s JOIN device d ON d.id = s.device_id
        WHERE s.flags IS NULL ORDER BY s.score DESC LIMIT ?`,
      SNAPSHOT_WINDOW,
    );

    // `SCAN ... USING INDEX` with no temp B-tree walks the index in order and
    // stops at the LIMIT, so the cost is flat. The rule exists to catch
    // unbounded reads; this read is bounded. Any other SCAN still does not merge.
    expect(plan.join('\n')).toContain('idx_session_alltime');
    expect(plan.join('\n')).not.toContain('TEMP B-TREE');
  });

  it('proves the GROUP BY alternative is the thing being avoided', () => {
    // Not a query the Worker runs. It is here because the whole shape of this
    // module is a reaction to this plan, and a comment claiming a temp B-tree is
    // weaker than a test that shows one.
    //
    // The `ORDER BY MAX(score) DESC LIMIT` matters and is not decoration: a bare
    // `GROUP BY device_id` walks `idx_session_device` and needs no temp B-tree.
    // It is asking for the *top* hundred devices that does, because the aggregate
    // has to be computed for every device in the season before any of them can be
    // ordered — which is the full pass, whatever the LIMIT says.
    const plan = db.explain(
      `SELECT device_id, MAX(score) AS best FROM session WHERE flags IS NULL
        GROUP BY device_id ORDER BY best DESC LIMIT ?`,
      SNAPSHOT_SIZE,
    );

    expect(plan.join('\n')).toContain('TEMP B-TREE');
  });

  it('searches the snapshot by rank for the board', () => {
    const plan = db.explain(
      `SELECT rank, device_id, display_name, avatar_seed, score, best_streak, achieved_at
         FROM leaderboard_snapshot WHERE season_id = ? AND scope = ? ORDER BY rank LIMIT ?`,
      ALL_TIME_SEASON,
      'all-time',
      50,
    );

    expect(plan.join('\n')).toContain('SEARCH');
    expect(plan.join('\n')).not.toContain('SCAN');
  });

  it('searches the snapshot by device for an exact rank', () => {
    const plan = db.explain(
      `SELECT rank FROM leaderboard_snapshot
        WHERE season_id = ? AND scope = ? AND device_id = ? LIMIT 1`,
      ALL_TIME_SEASON,
      'all-time',
      'd0',
    );

    // This is what `idx_snapshot_device` was added for in 0002; without it the
    // primary key cannot answer a lookup by device and this reports a scan.
    expect(plan.join('\n')).toContain('idx_snapshot_device');
    expect(plan.join('\n')).not.toContain('SCAN');
  });

  it('searches the histogram by its primary key', () => {
    const plan = db.explain(
      `SELECT bucket_min, count_at_or_above FROM score_histogram
        WHERE season_id = ? AND scope = ? ORDER BY bucket_min DESC LIMIT ?`,
      ALL_TIME_SEASON,
      'all-time',
      HISTOGRAM_BUCKETS + 1,
    );

    expect(plan.join('\n')).toContain('SEARCH');
    expect(plan.join('\n')).not.toContain('SCAN');
  });

  it('searches the device row by token hash', () => {
    const plan = db.explain(
      `SELECT id, best_score FROM device WHERE token_hash = ? LIMIT 1`,
      'hash-a',
    );

    expect(plan.join('\n')).toContain('SEARCH');
    expect(plan.join('\n')).not.toContain('SCAN');
  });
});

describe('snapshotAgeSeconds', () => {
  it('is null before the first build', async () => {
    expect(await snapshotAgeSeconds('all-time', deps())).toBeNull();
  });

  it('is zero immediately after a build and grows with the clock', async () => {
    device('a');
    session('a', 100);
    await rebuildScope('all-time', deps());

    expect(await snapshotAgeSeconds('all-time', deps())).toBe(0);
    expect(await snapshotAgeSeconds('all-time', deps(NOW + 605_000))).toBe(605);
  });

  it('is readable for a season nobody played, which is why it lives on the histogram', async () => {
    await rebuildScope('week', deps());

    expect(db.read('SELECT * FROM leaderboard_snapshot')).toEqual([]);
    expect(await snapshotAgeSeconds('week', deps())).toBe(0);
  });

  it('never reports a negative age', async () => {
    device('a');
    session('a', 100);
    await rebuildScope('all-time', deps());

    // A Worker whose clock ran ahead of the one that built the snapshot.
    expect(await snapshotAgeSeconds('all-time', deps(NOW - 60_000))).toBe(0);
  });

  it('is null for a built_at nothing can parse', async () => {
    device('a');
    session('a', 100);
    await rebuildScope('all-time', deps());
    db.seed("UPDATE score_histogram SET built_at = 'not a date'");

    expect(await snapshotAgeSeconds('all-time', deps())).toBeNull();
  });

  it('reads one row', async () => {
    device('a');
    session('a', 100);
    await rebuildScope('all-time', deps());

    db.resetCounters();
    await snapshotAgeSeconds('all-time', deps());
    expect(db.rowsRead).toBe(1);
  });
});
