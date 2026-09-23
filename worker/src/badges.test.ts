import { beforeEach, describe, expect, it } from 'vitest';
import { DAY_MS } from '../../shared/constants';
import { seasonIdFor } from '../../shared/season';
import { awardTopTen, badgesFor } from './badges';
import { TestD1 } from '../test/d1';

/** A Thursday in ISO week 2026-W39, so `now`'s week has a stable id. */
const NOW = Date.parse('2026-09-24T12:00:00.000Z');
const PREVIOUS_WEEK = seasonIdFor(NOW - 7 * DAY_MS);
const CURRENT_WEEK = seasonIdFor(NOW);

let db: TestD1;

function deps(now = NOW) {
  return { db: db as unknown as D1Database, now };
}

function device(id: string) {
  db.seed(
    `INSERT INTO device (id, token_hash, display_name, avatar_seed, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    id,
    `hash-${id}`,
    `Namn ${id}`,
    `seed-${id}`,
    '2026-09-01T00:00:00.000Z',
    '2026-09-01T00:00:00.000Z',
  );
}

function snapshotRow(
  deviceId: string,
  rank: number,
  options: { seasonId?: string; scope?: string } = {},
) {
  db.seed(
    `INSERT INTO leaderboard_snapshot
       (season_id, scope, rank, device_id, display_name, avatar_seed, score, best_streak, achieved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    options.seasonId ?? PREVIOUS_WEEK,
    options.scope ?? 'week',
    rank,
    deviceId,
    `Namn ${deviceId}`,
    `seed-${deviceId}`,
    1000 - rank,
    5,
    '2026-09-20T00:00:00.000Z',
  );
}

beforeEach(() => {
  db = new TestD1();
});

describe('awardTopTen', () => {
  it('awards top-ten to every device ranked 1-10 in the previous week', async () => {
    for (let rank = 1; rank <= 10; rank += 1) {
      device(`d${rank}`);
      snapshotRow(`d${rank}`, rank);
    }

    await awardTopTen(deps());

    const rows = db.read<{ device_id: string }>(
      "SELECT device_id FROM badge_award WHERE badge_id = 'top-ten' ORDER BY device_id",
    );
    expect(rows.map((r) => r.device_id).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `d${i + 1}`).sort(),
    );
  });

  it('does not award rank 11', async () => {
    device('d10');
    snapshotRow('d10', 10);
    device('d11');
    snapshotRow('d11', 11);

    await awardTopTen(deps());

    const rows = db.read("SELECT device_id FROM badge_award WHERE badge_id = 'top-ten'");
    expect(rows).toHaveLength(1);
    expect(db.read("SELECT device_id FROM badge_award WHERE device_id = 'd11'")).toEqual([]);
  });

  it('never reads the current, still-moving week', async () => {
    device('d1');
    // Ranked first, but in the *current* week, not the previous one.
    snapshotRow('d1', 1, { seasonId: CURRENT_WEEK });

    await awardTopTen(deps());

    expect(db.read('SELECT * FROM badge_award')).toEqual([]);
  });

  it('ignores the all-time scope even at rank 1 of the previous week id', async () => {
    device('d1');
    snapshotRow('d1', 1, { scope: 'all-time' });

    await awardTopTen(deps());

    expect(db.read('SELECT * FROM badge_award')).toEqual([]);
  });

  it('is idempotent across repeated calls', async () => {
    device('d1');
    snapshotRow('d1', 1);

    await awardTopTen(deps());
    await awardTopTen(deps());

    expect(db.read('SELECT * FROM badge_award')).toHaveLength(1);
  });

  it('is a no-op when no snapshot exists yet', async () => {
    await expect(awardTopTen(deps())).resolves.toBeUndefined();
    expect(db.read('SELECT * FROM badge_award')).toEqual([]);
  });
});

describe('badgesFor', () => {
  it('returns every distinct badge id a device has earned', async () => {
    device('d1');
    db.seed(
      `INSERT INTO badge_award (device_id, badge_id, season_id, awarded_at)
       VALUES (?, ?, '', ?)`,
      'd1',
      'first-session',
      '2026-09-01T00:00:00.000Z',
    );
    db.seed(
      `INSERT INTO badge_award (device_id, badge_id, season_id, awarded_at)
       VALUES (?, ?, ?, ?)`,
      'd1',
      'top-ten',
      PREVIOUS_WEEK,
      '2026-09-20T00:00:00.000Z',
    );

    const badges = await badgesFor('d1', db as unknown as D1Database);
    expect(badges.sort()).toEqual(['first-session', 'top-ten'].sort());
  });

  it('returns each repeatable badge only once, even across seasons', async () => {
    device('d1');
    db.seed(
      `INSERT INTO badge_award (device_id, badge_id, season_id, awarded_at)
       VALUES (?, 'top-ten', ?, ?)`,
      'd1',
      PREVIOUS_WEEK,
      '2026-09-20T00:00:00.000Z',
    );
    db.seed(
      `INSERT INTO badge_award (device_id, badge_id, season_id, awarded_at)
       VALUES (?, 'top-ten', ?, ?)`,
      'd1',
      CURRENT_WEEK,
      '2026-09-24T00:00:00.000Z',
    );

    const badges = await badgesFor('d1', db as unknown as D1Database);
    expect(badges).toEqual(['top-ten']);
  });

  it('returns nothing for a device that has earned no badges', async () => {
    device('d1');
    const badges = await badgesFor('d1', db as unknown as D1Database);
    expect(badges).toEqual([]);
  });
});
