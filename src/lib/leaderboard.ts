import type { Profile, SessionResult } from '../types/progress';

export type Scope = 'all-time' | 'week';

export interface LeaderRow {
  rank: number;
  displayName: string;
  avatarSeed: string;
  score: number;
  bestStreak: number;
  achievedAt: string; // ISO
  isMe: boolean;
}

/** A row before it knows where it placed. */
export type UnrankedRow = Omit<LeaderRow, 'rank'>;

/**
 * Bundled scenery. Dates are offsets rather than timestamps so the board still
 * reads as "the last two weeks" a year after this file was written.
 */
export interface Ghost {
  displayName: string;
  avatarSeed: string;
  score: number;
  bestStreak: number;
  daysAgo: number;
}

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function ghostRows(ghosts: readonly Ghost[], now: number): UnrankedRow[] {
  return ghosts.map((ghost) => ({
    displayName: ghost.displayName,
    avatarSeed: ghost.avatarSeed,
    score: ghost.score,
    bestStreak: ghost.bestStreak,
    achievedAt: new Date(now - ghost.daysAgo * DAY_MS).toISOString(),
    isMe: false,
  }));
}

/** One row per session: the board ranks runs, not lifetime totals. */
export function sessionRows(
  sessions: readonly SessionResult[],
  profile: Profile | null,
): UnrankedRow[] {
  return sessions.map((session) => ({
    displayName: profile?.displayName ?? 'Du',
    avatarSeed: profile?.avatarSeed ?? 'du',
    score: session.score,
    bestStreak: session.bestStreak,
    achievedAt: session.endedAt,
    isMe: true,
  }));
}

export function isWithinWeek(achievedAt: string, now: number): boolean {
  const at = Date.parse(achievedAt);
  // An unparseable date is scenery from a hand-edited file, not this week's run.
  if (Number.isNaN(at)) return false;
  return at > now - WEEK_MS && at <= now;
}

/** Score first. A tie goes to whoever got there earlier. */
function compare(a: UnrankedRow, b: UnrankedRow): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.achievedAt !== b.achievedAt) return a.achievedAt < b.achievedAt ? -1 : 1;
  return a.displayName < b.displayName ? -1 : 1;
}

export function rankRows(rows: readonly UnrankedRow[], scope: Scope, now: number): LeaderRow[] {
  const inScope = scope === 'week' ? rows.filter((row) => isWithinWeek(row.achievedAt, now)) : rows;
  return [...inScope].sort(compare).map((row, index) => ({ ...row, rank: index + 1 }));
}

/** The learner's best placing, or null if they have not played in this scope. */
export function myRank(rows: readonly LeaderRow[]): number | null {
  for (const row of rows) {
    if (row.isMe) return row.rank;
  }
  return null;
}
