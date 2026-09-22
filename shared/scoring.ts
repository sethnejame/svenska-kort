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
