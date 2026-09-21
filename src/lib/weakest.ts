import type { WordStat } from '../types/progress';
import type { WordEntry } from '../types/word';

/** How many words the weakest deck drills in one go. */
export const WEAKEST_DECK_SIZE = 20;

/** Share of sightings the learner got right, 0–1. */
function correctRate(stat: WordStat): number {
  return stat.correct / stat.seen;
}

/**
 * The words the learner gets wrong most often, worst first.
 *
 * Only a word that has actually been missed qualifies: an unseen word has no
 * record to be weak on, and one answered right every time is not what the
 * learner came here to drill. Ties go to the word missed the most times, so a
 * word wrong five of ten outranks one wrong once of two.
 */
export function weakestEntries(
  entries: readonly WordEntry[],
  stats: Readonly<Record<string, WordStat>>,
): WordEntry[] {
  const weak: { entry: WordEntry; stat: WordStat }[] = [];
  for (const entry of entries) {
    const stat = stats[entry.id];
    // `seen` is guarded as well as `wrong` because a hand-edited import could
    // carry a miss with no sighting, and that would divide by zero.
    if (stat !== undefined && stat.seen > 0 && stat.wrong > 0) weak.push({ entry, stat });
  }

  weak.sort((a, b) => {
    const byRate = correctRate(a.stat) - correctRate(b.stat);
    if (byRate !== 0) return byRate;
    const byWrong = b.stat.wrong - a.stat.wrong;
    if (byWrong !== 0) return byWrong;
    // A last resort so the deck is the same list twice running.
    return a.entry.id.localeCompare(b.entry.id);
  });

  return weak.slice(0, WEAKEST_DECK_SIZE).map((item) => item.entry);
}
