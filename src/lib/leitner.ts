import type { LeitnerBox, WordStat } from '../types/progress';
import type { WordEntry } from '../types/word';
import type { Verdict } from './checkAnswer';

const MAX_BOX = 5;

/**
 * How many sessions a word rests in each box before it comes round again. A
 * word answered correctly five times running is not asked for sixteen sessions.
 */
export const BOX_INTERVALS: Record<LeitnerBox, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16 };

/** The longest any word can rest. Used when backfilling learners from v1. */
export const MAX_INTERVAL = BOX_INTERVALS[5];

/**
 * A word is due when it has rested for its box's interval. A word never seen
 * is due immediately — a new deck must not start empty.
 */
export function isDue(stat: WordStat | undefined, session: number): boolean {
  if (stat === undefined) return true;
  return session - stat.lastSeenSession >= BOX_INTERVALS[stat.box];
}

/** The entries a session should ask about. Empty means everything is resting. */
export function dueEntries(
  entries: readonly WordEntry[],
  stats: Readonly<Record<string, WordStat>>,
  session: number,
): WordEntry[] {
  return entries.filter((entry) => isDue(stats[entry.id], session));
}

export function dueCount(
  entryIds: readonly string[],
  stats: Readonly<Record<string, WordStat>>,
  session: number,
): number {
  let due = 0;
  for (const id of entryIds) {
    if (isDue(stats[id], session)) due += 1;
  }
  return due;
}

/**
 * Correct promotes one box, close holds, wrong drops to box 1.
 */
export function nextBox(current: LeitnerBox, verdict: Verdict): LeitnerBox {
  switch (verdict) {
    case 'correct':
      return Math.min(MAX_BOX, current + 1) as LeitnerBox;
    case 'close':
      return current;
    case 'wrong':
      return 1;
  }
}
