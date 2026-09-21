import { describe, expect, it } from 'vitest';
import type { LeitnerBox, SessionResult, WordStat } from '../types/progress';
import { accuracyTrend, dayStreak, heatmap, localDay, mastery, totals } from './stats';

function session(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    id: 's1',
    deckId: 'alla',
    startedAt: '2026-09-21T09:00:00.000Z',
    endedAt: '2026-09-21T09:10:00.000Z',
    answered: 10,
    correct: 7,
    bestStreak: 3,
    score: 90,
    ...overrides,
  };
}

function stat(box: LeitnerBox, id = 'a'): WordStat {
  return {
    entryId: id,
    seen: 3,
    correct: 2,
    wrong: 1,
    lastSeenAt: '2026-09-21T09:00:00.000Z',
    box,
    lastSeenSession: 4,
  };
}

/** Local noon, so no timezone can push the date onto a neighbouring day. */
function noon(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

function ended(year: number, month: number, day: number, answered = 10): SessionResult {
  return session({
    id: `${String(year)}-${String(month)}-${String(day)}`,
    endedAt: noon(year, month, day).toISOString(),
    answered,
  });
}

describe('totals', () => {
  it('is all zeroes, not NaN, before the first run', () => {
    expect(totals([])).toEqual({ sessions: 0, answered: 0, correct: 0, accuracy: 0 });
  });

  it('adds every run up and divides once at the end', () => {
    const result = totals([
      session({ answered: 10, correct: 5 }),
      session({ answered: 30, correct: 25 }),
    ]);
    expect(result).toEqual({ sessions: 2, answered: 40, correct: 30, accuracy: 0.75 });
  });

  it('counts a run that was abandoned without an answer', () => {
    expect(totals([session({ answered: 0, correct: 0 })])).toEqual({
      sessions: 1,
      answered: 0,
      correct: 0,
      accuracy: 0,
    });
  });
});

describe('mastery', () => {
  it('reports five empty boxes for a learner who has done nothing', () => {
    expect(mastery({})).toEqual({
      started: 0,
      mastered: 0,
      byBox: [
        { box: 1, count: 0 },
        { box: 2, count: 0 },
        { box: 3, count: 0 },
        { box: 4, count: 0 },
        { box: 5, count: 0 },
      ],
    });
  });

  it('counts box four and five as mastered and nothing below', () => {
    const result = mastery({
      a: stat(1, 'a'),
      b: stat(3, 'b'),
      c: stat(4, 'c'),
      d: stat(5, 'd'),
      e: stat(5, 'e'),
    });

    expect(result.started).toBe(5);
    expect(result.mastered).toBe(3);
    expect(result.byBox).toEqual([
      { box: 1, count: 1 },
      { box: 2, count: 0 },
      { box: 3, count: 1 },
      { box: 4, count: 1 },
      { box: 5, count: 2 },
    ]);
  });
});

describe('localDay', () => {
  it('names the day in the learner’s own timezone, zero-padded', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });
});

describe('heatmap', () => {
  it('starts on a Monday and ends on the day asked for', () => {
    // 2026-09-21 is a Monday.
    const cells = heatmap([], noon(2026, 9, 21), 2);

    expect(cells).toHaveLength(8);
    expect(cells[0]?.day).toBe('2026-09-14');
    expect(cells.at(-1)?.day).toBe('2026-09-21');
  });

  it('runs the window back to the Monday of the opening week', () => {
    // 2026-09-24 is a Thursday, so a one-week window still opens on the 21st.
    const cells = heatmap([], noon(2026, 9, 24), 1);
    expect(cells[0]?.day).toBe('2026-09-21');
    expect(cells).toHaveLength(4);
  });

  it('adds up every run that landed on the same day', () => {
    const cells = heatmap(
      [ended(2026, 9, 21, 6), ended(2026, 9, 21, 9), ended(2026, 9, 20, 4)],
      noon(2026, 9, 21),
      1,
    );

    const byDay = new Map(cells.map((cell) => [cell.day, cell.answered]));
    expect(byDay.get('2026-09-21')).toBe(15);
    expect(byDay.get('2026-09-20')).toBeUndefined();
  });

  it('ignores runs from outside the window', () => {
    const cells = heatmap([ended(2025, 1, 1, 40)], noon(2026, 9, 21), 1);
    expect(cells.every((cell) => cell.answered === 0)).toBe(true);
  });

  it('steps the level up with the day’s work', () => {
    const days = [
      ended(2026, 9, 15, 0),
      ended(2026, 9, 16, 5),
      ended(2026, 9, 17, 10),
      ended(2026, 9, 18, 25),
      ended(2026, 9, 19, 50),
    ];
    const cells = heatmap(days, noon(2026, 9, 21), 2);
    const levels = cells.map((cell) => cell.level);

    // Mon 14 Sep through Mon 21 Sep: a quiet Monday, then the five days above.
    expect(levels).toEqual([0, 0, 1, 2, 3, 4, 0, 0]);
  });
});

describe('dayStreak', () => {
  it('is zero with nothing played', () => {
    expect(dayStreak([], noon(2026, 9, 21))).toBe(0);
  });

  it('counts back from today', () => {
    const sessions = [ended(2026, 9, 19), ended(2026, 9, 20), ended(2026, 9, 21)];
    expect(dayStreak(sessions, noon(2026, 9, 21))).toBe(3);
  });

  it('survives a day that is not over yet', () => {
    const sessions = [ended(2026, 9, 19), ended(2026, 9, 20)];
    expect(dayStreak(sessions, noon(2026, 9, 21))).toBe(2);
  });

  it('breaks once a whole day has gone by unplayed', () => {
    const sessions = [ended(2026, 9, 18), ended(2026, 9, 19)];
    expect(dayStreak(sessions, noon(2026, 9, 21))).toBe(0);
  });

  it('stops at the gap rather than counting everything ever played', () => {
    const sessions = [ended(2026, 9, 10), ended(2026, 9, 20), ended(2026, 9, 21)];
    expect(dayStreak(sessions, noon(2026, 9, 21))).toBe(2);
  });

  it('counts two runs on one day once', () => {
    const sessions = [
      session({ id: 'a', endedAt: noon(2026, 9, 21).toISOString() }),
      session({ id: 'b', endedAt: noon(2026, 9, 21).toISOString() }),
    ];
    expect(dayStreak(sessions, noon(2026, 9, 21))).toBe(1);
  });
});

describe('accuracyTrend', () => {
  it('is empty before anything has been answered', () => {
    expect(accuracyTrend([])).toEqual([]);
  });

  it('leaves out a run that was abandoned without an answer', () => {
    const points = accuracyTrend([
      session({ id: 'a', answered: 4, correct: 2 }),
      session({ id: 'b', answered: 0, correct: 0 }),
    ]);

    expect(points).toHaveLength(1);
    expect(points[0]).toMatchObject({ id: 'a', accuracy: 0.5, answered: 4 });
  });

  it('keeps the most recent runs, oldest first', () => {
    const sessions = [1, 2, 3, 4].map((n) => session({ id: `s${String(n)}` }));
    const points = accuracyTrend(sessions, 2);
    expect(points.map((point) => point.id)).toEqual(['s3', 's4']);
  });
});
