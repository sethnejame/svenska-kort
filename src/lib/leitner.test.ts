import { describe, expect, it } from 'vitest';
import type { LeitnerBox, WordStat } from '../types/progress';
import type { WordEntry } from '../types/word';
import { BOX_INTERVALS, dueCount, dueEntries, isDue, MAX_INTERVAL, nextBox } from './leitner';

function stat(entryId: string, box: LeitnerBox, lastSeenSession: number): WordStat {
  return { entryId, seen: 1, correct: 1, wrong: 0, lastSeenAt: '', box, lastSeenSession };
}

function entry(id: string): WordEntry {
  return { id, swedish: 'ord', english: ['word'], pos: 'other' };
}

describe('nextBox', () => {
  it('promotes one box on correct and caps at five', () => {
    expect(nextBox(1, 'correct')).toBe(2);
    expect(nextBox(4, 'correct')).toBe(5);
    expect(nextBox(5, 'correct')).toBe(5);
  });

  it('holds on close', () => {
    expect(nextBox(3, 'close')).toBe(3);
  });

  it('drops to box one on wrong', () => {
    expect(nextBox(5, 'wrong')).toBe(1);
    expect(nextBox(1, 'wrong')).toBe(1);
  });
});

describe('isDue', () => {
  it('treats a word never answered as due', () => {
    expect(isDue(undefined, 1)).toBe(true);
  });

  it('rests a word for its box interval and asks for it on the interval itself', () => {
    expect(BOX_INTERVALS).toEqual({ 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 });

    // Box 3 rests four sessions: due in the fourth session after, not the third.
    expect(isDue(stat('a', 3, 10), 13)).toBe(false);
    expect(isDue(stat('a', 3, 10), 14)).toBe(true);
  });

  it('asks about a box-one word in the very next session', () => {
    expect(isDue(stat('a', 1, 10), 11)).toBe(true);
  });

  it('rests a mastered word longest', () => {
    expect(isDue(stat('a', 5, 0), MAX_INTERVAL - 1)).toBe(false);
    expect(isDue(stat('a', 5, 0), MAX_INTERVAL)).toBe(true);
  });
});

describe('dueEntries', () => {
  const stats = { a: stat('a', 1, 10), b: stat('b', 5, 10) };

  it('keeps what is due and the words it has never seen', () => {
    const due = dueEntries([entry('a'), entry('b'), entry('c')], stats, 11);
    expect(due.map((e) => e.id)).toEqual(['a', 'c']);
  });

  it('returns nothing when the whole deck is resting', () => {
    expect(dueEntries([entry('a'), entry('b')], stats, 10)).toEqual([]);
  });
});

describe('dueCount', () => {
  it('counts what a deck would ask about', () => {
    const stats = { a: stat('a', 1, 10), b: stat('b', 5, 10) };
    expect(dueCount(['a', 'b', 'c'], stats, 11)).toBe(2);
    expect(dueCount([], stats, 11)).toBe(0);
  });
});
