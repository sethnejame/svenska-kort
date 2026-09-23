import type { SessionAnswer } from '../lib/scoring';

export interface Deck {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'user';
  entryIds: string[];
  createdAt: string; // ISO
}

export type LeitnerBox = 1 | 2 | 3 | 4 | 5;

export interface WordStat {
  entryId: string;
  seen: number;
  correct: number;
  wrong: number;
  lastSeenAt: string; // ISO
  box: LeitnerBox;
  /** Session number this word was last answered in, for the Leitner schedule. */
  lastSeenSession: number;
}

export interface SessionResult {
  id: string;
  deckId: string;
  startedAt: string; // ISO
  endedAt: string; // ISO
  answered: number;
  correct: number;
  bestStreak: number;
  score: number;
  /**
   * Per-answer record, so a remote submit can be replayed and re-scored
   * server-side. Absent on sessions banked before P06, and on an imported
   * backup, neither of which is ever resubmitted.
   */
  answers?: (SessionAnswer & { entryId: string })[] | undefined;
}

export interface Profile {
  displayName: string;
  avatarSeed: string;
  createdAt: string; // ISO
  totalScore: number;
  bestStreakEver: number;
}
