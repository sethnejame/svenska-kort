import { describe, expect, it } from 'vitest';
import type { LeitnerBox, WordStat } from '../types/progress';
import { deckProgress, MASTERED_BOX } from './progress';

function stat(entryId: string, box: LeitnerBox): WordStat {
  return { entryId, seen: 1, correct: 1, wrong: 0, lastSeenAt: '', box, lastSeenSession: 0 };
}

const STATS: Record<string, WordStat> = {
  a: stat('a', 1),
  b: stat('b', 3),
  c: stat('c', 4),
  d: stat('d', 5),
};

describe('deckProgress', () => {
  it('counts a word as mastered from box 4 up', () => {
    expect(deckProgress(['a', 'b', 'c', 'd'], STATS)).toEqual({
      total: 4,
      mastered: 2,
      ratio: 0.5,
    });
  });

  it('treats an unseen word as not mastered', () => {
    expect(deckProgress(['c', 'aldrig-sedd'], STATS)).toMatchObject({ total: 2, mastered: 1 });
  });

  it('reports zero rather than NaN for an empty deck', () => {
    expect(deckProgress([], STATS)).toEqual({ total: 0, mastered: 0, ratio: 0 });
  });

  it('agrees with the leitner box it names', () => {
    expect(deckProgress(['b'], { b: stat('b', MASTERED_BOX) }).mastered).toBe(1);
  });
});
