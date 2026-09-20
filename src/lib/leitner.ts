import type { LeitnerBox } from '../types/progress';
import type { Verdict } from './checkAnswer';

const MAX_BOX = 5;

/**
 * Correct promotes one box, close holds, wrong drops to box 1.
 *
 * v1 writes this field on every answer but never reads it for ordering —
 * phase 2 turns the schedule on, and it needs history to work with.
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
