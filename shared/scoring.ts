import type { Verdict } from './verdict';

const BASE_POINTS = 10;
const SPEED_BONUS = 5;
const SPEED_BONUS_UNDER_MS = 4000;
const MAX_MULTIPLIER = 3;

/** 1 + floor(streak / 5) * 0.5, capped at 3x. Answers 5-9 are worth 15, 25+ worth 30. */
export function multiplier(streak: number): number {
  return Math.min(MAX_MULTIPLIER, 1 + Math.floor(streak / 5) * 0.5);
}

export interface PointsInput {
  verdict: Verdict;
  streak: number; // streak BEFORE this answer
  elapsedMs: number;
  wasTyped: boolean; // false if the learner flipped first
  acceptedOnRetry: boolean;
}

export function pointsFor({
  verdict,
  streak,
  elapsedMs,
  wasTyped,
  acceptedOnRetry,
}: PointsInput): number {
  if (verdict !== 'correct') return 0;

  // A peeked card, or one revealed by flipping, scores nothing. The streak
  // survives that elsewhere — peeking has to stay cheap enough to be used.
  if (!wasTyped) return 0;

  // Accepted after a typo: base points, no multiplier growth, no speed bonus.
  if (acceptedOnRetry) return BASE_POINTS;

  const bonus = elapsedMs < SPEED_BONUS_UNDER_MS ? SPEED_BONUS : 0;
  return BASE_POINTS * multiplier(streak) + bonus;
}

/** One answer as the client reports it. The verdict is told, never re-graded. */
export interface SessionAnswer {
  verdict: Verdict;
  elapsedMs: number;
  wasTyped: boolean;
  acceptedOnRetry: boolean;
}

export interface SessionTotals {
  score: number;
  answered: number;
  correct: number;
  bestStreak: number;
}

/**
 * The whole session priced from its answers.
 *
 * This is the file that defines what a run is worth, and the Worker replays
 * every submission through it rather than storing the client's total. The streak
 * rules are the store's rules because they are written here once: a correct
 * typed answer extends the streak, a peeked one keeps it without extending, and
 * anything else resets it.
 */
export function replaySession(answers: readonly SessionAnswer[]): SessionTotals {
  let score = 0;
  let streak = 0;
  let bestStreak = 0;
  let correct = 0;

  for (const answer of answers) {
    score += pointsFor({ ...answer, streak });

    if (answer.verdict !== 'correct') {
      streak = 0;
      continue;
    }

    correct += 1;
    if (answer.wasTyped) streak += 1;
    // Inside the correct branch on purpose: a peeked answer leaves the streak
    // where it was, so there is never a new best to record.
    if (streak > bestStreak) bestStreak = streak;
  }

  return { score, answered: answers.length, correct, bestStreak };
}

/**
 * The per-answer timings as they are stored.
 *
 * A tuple rather than an object, and the verdict as a digit rather than a word:
 * `session.timings` is one row per session on a table that grows forever, and
 * this is the difference between ~15 KB and ~45 KB for a 500-answer session.
 */
export type PackedAnswer = [entryId: string, verdict: number, elapsedMs: number, bits: number];

const VERDICTS: readonly Verdict[] = ['correct', 'close', 'wrong'];
const TYPED = 1;
const RETRIED = 2;

export function packAnswers(
  answers: readonly (SessionAnswer & { entryId: string })[],
): PackedAnswer[] {
  return answers.map((answer) => [
    answer.entryId,
    VERDICTS.indexOf(answer.verdict),
    answer.elapsedMs,
    (answer.wasTyped ? TYPED : 0) | (answer.acceptedOnRetry ? RETRIED : 0),
  ]);
}

export function unpackAnswers(packed: readonly PackedAnswer[]): (SessionAnswer & {
  entryId: string;
})[] {
  return packed.map(([entryId, verdict, elapsedMs, bits]) => ({
    entryId,
    // A code outside the table means the row was written by something other than
    // `packAnswers`; 'wrong' is the reading that cannot inflate a score.
    verdict: VERDICTS[verdict] ?? 'wrong',
    elapsedMs,
    wasTyped: (bits & TYPED) !== 0,
    acceptedOnRetry: (bits & RETRIED) !== 0,
  }));
}
