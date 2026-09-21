import { describe, expect, it } from 'vitest';
import type { WordEntry } from '../types/word';
import type { WordStat } from '../types/progress';
import { selectNext, weightFor } from './selectNext';

function pool(size: number): WordEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `w${i}`,
    swedish: `ord${i}`,
    english: [`word${i}`],
    pos: 'other' as const,
  }));
}

function stat(entryId: string, seen: number, wrong: number): WordStat {
  return {
    entryId,
    seen,
    correct: seen - wrong,
    wrong,
    lastSeenAt: '2026-09-20T00:00:00Z',
    box: 1,
    lastSeenSession: 0,
  };
}

/** Mulberry32 — a small seeded PRNG so the draws are identical across runs. */
function seededRng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('weightFor', () => {
  it('weighs an unseen word 1 plus the full recency term', () => {
    const [entry] = pool(1);
    expect(entry && weightFor(entry, {}, [])).toBe(2);
  });

  it('weighs a word answered wrong every time more than one always right', () => {
    const [entry] = pool(1);
    if (!entry) throw new Error('fixture');
    const allWrong = weightFor(entry, { w0: stat('w0', 5, 5) }, []);
    const allRight = weightFor(entry, { w0: stat('w0', 5, 0) }, []);
    expect(allWrong).toBe(4);
    expect(allRight).toBe(2);
  });

  it('damps a word that was just drawn', () => {
    const [entry] = pool(1);
    if (!entry) throw new Error('fixture');
    expect(weightFor(entry, {}, ['w0'])).toBe(1);
    expect(weightFor(entry, {}, ['other', 'w0'])).toBe(1.2);
  });
});

describe('selectNext', () => {
  it('throws on an empty pool', () => {
    expect(() => selectNext([], {}, [], Math.random)).toThrow(/empty pool/);
  });

  it('is deterministic for a given seed', () => {
    const deck = pool(30);
    const draw = (): string[] => {
      const rng = seededRng(7);
      const recent: string[] = [];
      for (let i = 0; i < 20; i++) recent.unshift(selectNext(deck, {}, recent, rng).id);
      return recent;
    };
    expect(draw()).toEqual(draw());
  });

  it('never repeats within five draws on a 30-word pool', () => {
    const deck = pool(30);
    const rng = seededRng(11);
    const recent: string[] = [];
    for (let i = 0; i < 200; i++) {
      const next = selectNext(deck, {}, recent, rng);
      expect(recent.slice(0, 5)).not.toContain(next.id);
      recent.unshift(next.id);
    }
  });

  it('never repeats back to back on a four-word pool', () => {
    const deck = pool(4);
    const rng = seededRng(3);
    const recent: string[] = [];
    for (let i = 0; i < 100; i++) {
      const next = selectNext(deck, {}, recent, rng);
      expect(recent[0]).not.toBe(next.id);
      recent.unshift(next.id);
    }
  });

  it('falls back to the whole pool when every word is blocked', () => {
    const deck = pool(1);
    const only = selectNext(deck, {}, ['w0'], seededRng(1));
    expect(only.id).toBe('w0');
  });

  /**
   * The weights are exactly 2:1 (4 vs 2, asserted in `weightFor` above). The
   * observed draw rate lands near 1.65:1 rather than 2:1 because the heavier
   * word is drawn more often and so spends more turns inside the five-draw
   * no-repeat window, which excludes it outright. That compression is the
   * no-repeat rule working, not a weighting bug — measured at 2.02:1 with the
   * exclusion disabled.
   */
  it('draws a word answered wrong markedly more often than one always right', () => {
    const deck = pool(30);
    const stats: Record<string, WordStat> = {
      w0: stat('w0', 5, 5),
      w1: stat('w1', 5, 0),
    };
    const rng = seededRng(2026);
    const counts = new Map<string, number>();
    const recent: string[] = [];

    for (let i = 0; i < 10_000; i++) {
      const next = selectNext(deck, stats, recent, rng);
      counts.set(next.id, (counts.get(next.id) ?? 0) + 1);
      recent.unshift(next.id);
      if (recent.length > 10) recent.pop();
    }

    const wrongOften = counts.get('w0') ?? 0;
    const alwaysRight = counts.get('w1') ?? 0;
    expect(wrongOften / alwaysRight).toBeGreaterThanOrEqual(1.5);
  });

  it('rejects an rng that does not return a number in range', () => {
    expect(() => selectNext(pool(3), {}, [], () => NaN)).toThrow(/rng/);
  });
});
