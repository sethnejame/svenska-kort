import type { WordEntry } from '../types/word';
import { alternates, foldSwedish, normalize, normalizeSwedish } from './normalize';
import { levenshtein } from './levenshtein';

export type Verdict = 'correct' | 'close' | 'wrong';

export interface AnswerVerdict {
  verdict: Verdict;
  matched?: string; // the accepted answer it matched, un-normalized
  distance?: number; // set when verdict is 'close' via fuzzy
  reason?: 'exact' | 'alternate' | 'fuzzy' | 'substring' | 'folded';
}

const MIN_FUZZY_LENGTH = 4;
const LONG_INPUT_LENGTH = 8;

/** Fuzzy tolerance: one typo in a short word, two in a long one. */
function fuzzyTolerance(length: number): number {
  return length >= LONG_INPUT_LENGTH ? 2 : 1;
}

function wordCount(s: string): number {
  return s.split(' ').filter(Boolean).length;
}

/**
 * Grades a typed answer against an entry.
 *
 * `allAnswers` is the normalized set of every accepted answer across the loaded
 * deck. It exists for the stop-list guard: `increased` is edit-distance 2 from
 * `decreased`, but it is a real English word with the opposite meaning, so
 * calling it "almost right" would teach the learner the wrong thing.
 */
export function checkAnswer(
  input: string,
  entry: WordEntry,
  allAnswers: ReadonlySet<string>,
): AnswerVerdict {
  const typed = normalize(input);
  if (typed.length === 0) return { verdict: 'wrong' };

  for (const answer of entry.english) {
    if (normalize(answer) === typed) return { verdict: 'correct', matched: answer, reason: 'exact' };
  }

  for (const answer of entry.english) {
    if (alternates(answer).includes(typed)) {
      return { verdict: 'correct', matched: answer, reason: 'alternate' };
    }
  }

  // Stop-list guard: a word this entry does not accept, but some other entry does.
  if (allAnswers.has(typed)) return { verdict: 'wrong' };

  if (typed.length >= MIN_FUZZY_LENGTH) {
    const tolerance = fuzzyTolerance(typed.length);
    let best: { answer: string; distance: number } | undefined;

    for (const answer of entry.english) {
      for (const candidate of [normalize(answer), ...alternates(answer)]) {
        const distance = levenshtein(typed, candidate);
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { answer, distance };
        }
      }
    }

    if (best) {
      return { verdict: 'close', matched: best.answer, distance: best.distance, reason: 'fuzzy' };
    }
  }

  for (const answer of entry.english) {
    for (const candidate of [normalize(answer), ...alternates(answer)]) {
      const longEnough = wordCount(candidate) >= 3 || wordCount(typed) >= 3;
      if (!longEnough) continue;
      if (candidate.includes(typed) || typed.includes(candidate)) {
        return { verdict: 'close', matched: answer, reason: 'substring' };
      }
    }
  }

  return { verdict: 'wrong' };
}

/** Builds the stop-list for a deck: every accepted answer, normalized, plus its alternates. */
export function collectAllAnswers(entries: readonly WordEntry[]): ReadonlySet<string> {
  const all = new Set<string>();
  for (const entry of entries) {
    for (const answer of entry.english) {
      all.add(normalize(answer));
      for (const piece of alternates(answer)) all.add(piece);
    }
  }
  return all;
}

/**
 * What counts as the Swedish answer: the form on the card, and the dictionary
 * form behind it. An English prompt cannot say which inflection it wants, so
 * the lemma has to be allowed through.
 */
function swedishAnswers(entry: WordEntry): string[] {
  if (entry.lemma === undefined || entry.lemma === entry.swedish) return [entry.swedish];
  return [entry.swedish, entry.lemma];
}

/**
 * Grades a typed Swedish answer, for reverse mode.
 *
 * The tier `checkAnswer` has no need of is the fold: `aao` is accepted for
 * `åäö` so a learner without those keys is not locked out. That fold is also
 * why the stop-list matters more here than it does the other way round —
 * `har` and `hår` are different words that fold onto each other, so a typed
 * form some other entry owns outright is wrong rather than nearly right.
 */
export function checkSwedish(
  input: string,
  entry: WordEntry,
  allSwedish: ReadonlySet<string>,
): AnswerVerdict {
  const typed = normalizeSwedish(input);
  if (typed.length === 0) return { verdict: 'wrong' };

  const accepted = swedishAnswers(entry);

  for (const answer of accepted) {
    if (normalizeSwedish(answer) === typed) {
      return { verdict: 'correct', matched: answer, reason: 'exact' };
    }
  }

  if (allSwedish.has(typed)) return { verdict: 'wrong' };

  const folded = foldSwedish(typed);
  for (const answer of accepted) {
    if (foldSwedish(normalizeSwedish(answer)) === folded) {
      return { verdict: 'correct', matched: answer, reason: 'folded' };
    }
  }

  if (folded.length >= MIN_FUZZY_LENGTH) {
    const tolerance = fuzzyTolerance(folded.length);
    let best: { answer: string; distance: number } | undefined;

    for (const answer of accepted) {
      const distance = levenshtein(folded, foldSwedish(normalizeSwedish(answer)));
      if (distance <= tolerance && (!best || distance < best.distance)) {
        best = { answer, distance };
      }
    }

    if (best) {
      return { verdict: 'close', matched: best.answer, distance: best.distance, reason: 'fuzzy' };
    }
  }

  return { verdict: 'wrong' };
}

/** The stop-list for reverse mode: every Swedish form the deck lays claim to. */
export function collectAllSwedish(entries: readonly WordEntry[]): ReadonlySet<string> {
  const all = new Set<string>();
  for (const entry of entries) {
    for (const answer of swedishAnswers(entry)) all.add(normalizeSwedish(answer));
  }
  return all;
}
