import { describe, expect, it } from 'vitest';
import type { WordStat } from '../types/progress';
import type { WordEntry } from '../types/word';
import { weakestEntries, WEAKEST_DECK_SIZE } from './weakest';

function pool(size: number): WordEntry[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `w${String(i).padStart(2, '0')}`,
    swedish: `ord${String(i)}`,
    english: [`word${String(i)}`],
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

function ids(entries: readonly WordEntry[]): string[] {
  return entries.map((entry) => entry.id);
}

describe('weakestEntries', () => {
  it('takes nothing from a learner who has never missed a word', () => {
    const deck = pool(3);
    expect(weakestEntries(deck, {})).toEqual([]);
    expect(weakestEntries(deck, { w00: stat('w00', 4, 0) })).toEqual([]);
  });

  it('orders by correct rate, worst first', () => {
    const deck = pool(3);
    const stats = {
      w00: stat('w00', 10, 3),
      w01: stat('w01', 10, 9),
      w02: stat('w02', 10, 6),
    };
    expect(ids(weakestEntries(deck, stats))).toEqual(['w01', 'w02', 'w00']);
  });

  it('leaves out a word the learner has never seen', () => {
    const deck = pool(2);
    expect(ids(weakestEntries(deck, { w01: stat('w01', 2, 1) }))).toEqual(['w01']);
  });

  it('breaks a tied rate on the number of misses', () => {
    const deck = pool(2);
    // Both sit at half right; five misses is the shakier record.
    const stats = { w00: stat('w00', 2, 1), w01: stat('w01', 10, 5) };
    expect(ids(weakestEntries(deck, stats))).toEqual(['w01', 'w00']);
  });

  it('gives the same order twice when rate and misses both tie', () => {
    const deck = pool(3);
    const stats = {
      w02: stat('w02', 4, 2),
      w00: stat('w00', 4, 2),
      w01: stat('w01', 4, 2),
    };
    expect(ids(weakestEntries(deck, stats))).toEqual(['w00', 'w01', 'w02']);
  });

  it('ignores a miss with no sighting behind it rather than dividing by zero', () => {
    const deck = pool(1);
    expect(weakestEntries(deck, { w00: { ...stat('w00', 0, 1), correct: 0 } })).toEqual([]);
  });

  it('stops at twenty words however many were missed', () => {
    const deck = pool(30);
    const stats: Record<string, WordStat> = {};
    for (const entry of deck) stats[entry.id] = stat(entry.id, 10, 9);

    const weakest = weakestEntries(deck, stats);
    expect(weakest).toHaveLength(WEAKEST_DECK_SIZE);
    // All thirty tie, so the tie-break decides and takes the first twenty ids.
    expect(ids(weakest).at(-1)).toBe('w19');
  });
});
