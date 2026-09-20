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
}

export interface Profile {
  displayName: string;
  avatarSeed: string;
  createdAt: string; // ISO
  totalScore: number;
  bestStreakEver: number;
}
