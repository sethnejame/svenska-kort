import type { WordEntry } from '../types/word';
import type { WordStat } from '../types/progress';

const NO_REPEAT_WINDOW = 5;
const SMALL_POOL = 10;

/**
 * How far back in `recent` a word has to be before it counts as "not seen for
 * a while" and gets its full weight back. Words inside the no-repeat window are
 * excluded outright, so in practice this only bites on pools under 10.
 */
function recencyPenalty(entryId: string, recent: readonly string[]): number {
  const index = recent.indexOf(entryId);
  if (index === -1) return 1;
  return Math.min(1, index / NO_REPEAT_WINDOW);
}

/** Weight = 1 + 2 * wrongRate + recencyPenalty. An unseen word weighs 1 and is drawable at once. */
export function weightFor(
  entry: WordEntry,
  stats: Readonly<Record<string, WordStat>>,
  recent: readonly string[],
): number {
  const stat = stats[entry.id];
  const wrongRate = stat ? stat.wrong / Math.max(1, stat.seen) : 0;
  return 1 + 2 * wrongRate + recencyPenalty(entry.id, recent);
}

export function selectNext(
  pool: readonly WordEntry[],
  stats: Readonly<Record<string, WordStat>>,
  recent: readonly string[], // last N drawn ids, most recent first
  rng: () => number, // injected, so tests are deterministic
): WordEntry {
  if (pool.length === 0) throw new Error('selectNext called with an empty pool');

  // A word cannot repeat within the last 5 draws, unless the pool is too small
  // to allow it — then the rule relaxes to "not the one just drawn".
  const blocked = new Set(
    pool.length < SMALL_POOL ? recent.slice(0, 1) : recent.slice(0, NO_REPEAT_WINDOW),
  );
  let candidates = pool.filter((entry) => !blocked.has(entry.id));
  if (candidates.length === 0) candidates = [...pool];

  const weighted = candidates.map((entry) => ({
    entry,
    weight: weightFor(entry, stats, recent),
  }));
  const total = weighted.reduce((sum, { weight }) => sum + weight, 0);

  // Every weight is at least 1, so a ticket in [0, total] always lands on a
  // candidate — `<=` rather than `<` covers an rng that returns exactly 1.
  let ticket = rng() * total;
  for (const { entry, weight } of weighted) {
    ticket -= weight;
    if (ticket <= 0) return entry;
  }

  throw new Error('selectNext: rng did not return a number in [0, 1]');
}
