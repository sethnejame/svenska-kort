import { describe, expect, it } from 'vitest';
import type { Profile, SessionResult } from '../types/progress';
import type { Ghost, UnrankedRow } from './leaderboard';
import { ghostRows, isWithinWeek, myRank, rankRows, sessionRows } from './leaderboard';

const NOW = Date.parse('2026-09-20T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const PROFILE: Profile = {
  displayName: 'Seth',
  avatarSeed: 'kanel',
  createdAt: '2026-09-01T00:00:00.000Z',
  totalScore: 400,
  bestStreakEver: 7,
};

function session(over: Partial<SessionResult> = {}): SessionResult {
  return {
    id: 'session-a',
    deckId: 'alla',
    startedAt: '2026-09-19T12:00:00.000Z',
    endedAt: '2026-09-19T12:10:00.000Z',
    answered: 10,
    correct: 8,
    bestStreak: 4,
    score: 200,
    ...over,
  };
}

function row(over: Partial<UnrankedRow> = {}): UnrankedRow {
  return {
    displayName: 'Nagon',
    avatarSeed: 'seed',
    score: 100,
    bestStreak: 2,
    achievedAt: '2026-09-19T12:00:00.000Z',
    isMe: false,
    ...over,
  };
}

describe('ghostRows', () => {
  const ghost: Ghost = {
    displayName: 'Verb-Viktor',
    avatarSeed: 'spoke1',
    score: 620,
    bestStreak: 18,
    daysAgo: 2,
  };

  it('dates a ghost backwards from now so it never ages out', () => {
    expect(ghostRows([ghost], NOW)).toEqual([
      {
        displayName: 'Verb-Viktor',
        avatarSeed: 'spoke1',
        score: 620,
        bestStreak: 18,
        achievedAt: new Date(NOW - 2 * DAY).toISOString(),
        isMe: false,
      },
    ]);
  });

  it('is never the learner', () => {
    expect(ghostRows([ghost], NOW).every((r) => !r.isMe)).toBe(true);
  });
});

describe('sessionRows', () => {
  it('makes one row per run, not one per learner', () => {
    const rows = sessionRows([session({ id: 'a' }), session({ id: 'b', score: 50 })], PROFILE);
    expect(rows.map((r) => r.score)).toEqual([200, 50]);
    expect(rows.every((r) => r.isMe && r.displayName === 'Seth')).toBe(true);
  });

  it('falls back to a placeholder name before the profile exists', () => {
    expect(sessionRows([session()], null)[0]).toMatchObject({
      displayName: 'Du',
      avatarSeed: 'du',
    });
  });
});

describe('isWithinWeek', () => {
  it('includes a six-day-old run', () => {
    expect(isWithinWeek(new Date(NOW - 6 * DAY).toISOString(), NOW)).toBe(true);
  });

  it('excludes an eight-day-old run', () => {
    expect(isWithinWeek(new Date(NOW - 8 * DAY).toISOString(), NOW)).toBe(false);
  });

  it('excludes a run dated in the future', () => {
    expect(isWithinWeek(new Date(NOW + DAY).toISOString(), NOW)).toBe(false);
  });

  it('excludes a date it cannot read', () => {
    expect(isWithinWeek('inte ett datum', NOW)).toBe(false);
  });
});

describe('rankRows', () => {
  it('ranks by score, highest first', () => {
    const ranked = rankRows([row({ score: 100 }), row({ score: 300 }), row({ score: 200 })], 'all-time', NOW);
    expect(ranked.map((r) => [r.rank, r.score])).toEqual([
      [1, 300],
      [2, 200],
      [3, 100],
    ]);
  });

  // Both tiebreaks are checked from either input order: a comparison that only
  // reads correctly one way round would still pass a single-order assertion.
  it('gives a tie to whoever got there first', () => {
    const late = row({ displayName: 'Sen', achievedAt: '2026-09-19T13:00:00.000Z' });
    const early = row({ displayName: 'Tidig', achievedAt: '2026-09-19T09:00:00.000Z' });

    expect(rankRows([late, early], 'all-time', NOW).map((r) => r.displayName)).toEqual([
      'Tidig',
      'Sen',
    ]);
    expect(rankRows([early, late], 'all-time', NOW).map((r) => r.displayName)).toEqual([
      'Tidig',
      'Sen',
    ]);
  });

  it('settles a dead heat by name so the order never jitters', () => {
    const bo = row({ displayName: 'Bo' });
    const ada = row({ displayName: 'Ada' });

    expect(rankRows([bo, ada], 'all-time', NOW).map((r) => r.displayName)).toEqual(['Ada', 'Bo']);
    expect(rankRows([ada, bo], 'all-time', NOW).map((r) => r.displayName)).toEqual(['Ada', 'Bo']);
  });

  it('drops anything older than a week from the week scope', () => {
    const ranked = rankRows(
      [
        row({ displayName: 'Nyss', score: 10, achievedAt: new Date(NOW - 6 * DAY).toISOString() }),
        row({ displayName: 'Gammal', score: 900, achievedAt: new Date(NOW - 8 * DAY).toISOString() }),
      ],
      'week',
      NOW,
    );
    expect(ranked.map((r) => r.displayName)).toEqual(['Nyss']);
  });

  it('leaves the input alone', () => {
    const rows = [row({ score: 1 }), row({ score: 2 })];
    rankRows(rows, 'all-time', NOW);
    expect(rows.map((r) => r.score)).toEqual([1, 2]);
  });

  it('copes with nothing at all', () => {
    expect(rankRows([], 'all-time', NOW)).toEqual([]);
  });
});

describe('myRank', () => {
  it('is null when the learner is not on the board', () => {
    expect(myRank(rankRows([row()], 'all-time', NOW))).toBeNull();
  });

  it('is null when the board is empty', () => {
    expect(myRank([])).toBeNull();
  });

  it('reports the best of several of the learner own runs', () => {
    const ranked = rankRows(
      [
        row({ score: 900 }),
        row({ score: 500, isMe: true }),
        row({ score: 100, isMe: true }),
        row({ score: 700 }),
      ],
      'all-time',
      NOW,
    );
    expect(myRank(ranked)).toBe(3);
  });
});
