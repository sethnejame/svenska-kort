import type { WordStat } from '../types/progress';

/** A word counts as mastered once Leitner has promoted it this far. */
export const MASTERED_BOX = 4;

export interface DeckProgress {
  total: number;
  mastered: number;
  /** 0–1, and 0 for an empty deck rather than NaN. */
  ratio: number;
}

export function deckProgress(
  entryIds: readonly string[],
  stats: Readonly<Record<string, WordStat>>,
): DeckProgress {
  let mastered = 0;
  for (const id of entryIds) {
    const stat = stats[id];
    if (stat !== undefined && stat.box >= MASTERED_BOX) mastered += 1;
  }

  const total = entryIds.length;
  return { total, mastered, ratio: total === 0 ? 0 : mastered / total };
}
