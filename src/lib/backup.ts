import { z } from 'zod';
import type { Deck, Profile, SessionResult, WordStat } from '../types/progress';
import type { WordEntry } from '../types/word';
import { wordEntrySchema } from '../data/schema';

/**
 * The on-disk backup. Everything a learner would be upset to lose and nothing
 * else: no mid-session state, no derived deck lists, no built-in entries.
 */
export interface BackupFile {
  schemaVersion: number;
  exportedAt: string;
  profile: Profile | null;
  userEntries: WordEntry[];
  userDecks: Deck[];
  stats: Record<string, WordStat>;
  sessionHistory: SessionResult[];
}

export const BACKUP_SCHEMA_VERSION = 1;
export const MAX_SESSION_HISTORY = 50;

const leitnerBoxSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const wordStatSchema = z.object({
  entryId: z.string().min(1),
  seen: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  wrong: z.number().int().nonnegative(),
  lastSeenAt: z.string(),
  box: leitnerBoxSchema,
  // Absent in files exported before the Leitner schedule was turned on. Those
  // words read as last seen in session 0, which makes them due on arrival.
  lastSeenSession: z.number().int().nonnegative().default(0),
});

const sessionResultSchema = z.object({
  id: z.string().min(1),
  deckId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  bestStreak: z.number().int().nonnegative(),
  score: z.number().int(),
});

const profileSchema = z.object({
  displayName: z.string().min(1),
  avatarSeed: z.string().min(1),
  createdAt: z.string(),
  totalScore: z.number().int(),
  bestStreakEver: z.number().int().nonnegative(),
});

const deckSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  source: z.enum(['builtin', 'user']),
  entryIds: z.array(z.string()),
  createdAt: z.string(),
});

/**
 * Strict where the persisted-state schema is forgiving. A file the learner
 * hands us is not our own writing, so a wrong shape is an error to report
 * rather than a field to default.
 */
export const backupSchema = z.object({
  schemaVersion: z.number(),
  exportedAt: z.string(),
  profile: profileSchema.nullable(),
  userEntries: z.array(wordEntrySchema),
  userDecks: z.array(deckSchema),
  stats: z.record(z.string(), wordStatSchema),
  sessionHistory: z.array(sessionResultSchema),
});

/** The slice of app state a backup covers, in and out. */
export interface BackupContents {
  profile: Profile | null;
  userEntries: WordEntry[];
  userDecks: Deck[];
  stats: Record<string, WordStat>;
  sessionHistory: SessionResult[];
}

export function buildBackup(contents: BackupContents, now: number): BackupFile {
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    profile: contents.profile,
    userEntries: contents.userEntries,
    userDecks: contents.userDecks,
    stats: contents.stats,
    sessionHistory: contents.sessionHistory,
  };
}

/** `svenska-kort-export-2026-09-20.json`, in the learner's own timezone. */
export function backupFilename(now: number): string {
  const date = new Date(now);
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `svenska-kort-export-${stamp}.json`;
}

export type ReadResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; error: string };

/** `userEntries.3.english` reads better to a learner as `userEntries[3].english`. */
function describePath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') out += `[${key}]`;
    else out += out === '' ? String(key) : `.${String(key)}`;
  }
  return out;
}

/**
 * The first issue is enough — a learner needs somewhere to start, not every
 * complaint at once. An empty list means the parser refused without saying why.
 */
export function describeIssues(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  const issue = issues[0];
  if (issue === undefined) return 'Filen har fel format.';

  const where = describePath(issue.path);
  if (where === '') return `Filen har fel format: ${issue.message}`;
  return `Fel i ${where}: ${issue.message}`;
}

/** Parses a whole file or nothing. There is no partial import. */
export function readBackup(text: string): ReadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Filen är inte giltig JSON.' };
  }

  const parsed = backupSchema.safeParse(raw);
  if (parsed.success) return { ok: true, backup: parsed.data };
  return { ok: false, error: describeIssues(parsed.error.issues) };
}

export interface BackupSummary {
  words: number;
  decks: number;
  stats: number;
  sessions: number;
}

export function summarize(backup: BackupFile): BackupSummary {
  return {
    words: backup.userEntries.length,
    decks: backup.userDecks.length,
    stats: Object.keys(backup.stats).length,
    sessions: backup.sessionHistory.length,
  };
}

/** Incoming wins on a clash of ids, and keeps the order it arrived in. */
function mergeById<T extends { id: string }>(current: readonly T[], incoming: readonly T[]): T[] {
  const byId = new Map<string, T>();
  for (const item of current) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function mergeStat(current: WordStat, incoming: WordStat): WordStat {
  // The later sighting is the one whose box reflects the most recent answer.
  const latest = incoming.lastSeenAt >= current.lastSeenAt ? incoming : current;
  return {
    entryId: current.entryId,
    seen: current.seen + incoming.seen,
    correct: current.correct + incoming.correct,
    wrong: current.wrong + incoming.wrong,
    lastSeenAt: latest.lastSeenAt,
    box: latest.box,
    lastSeenSession: Math.max(current.lastSeenSession, incoming.lastSeenSession),
  };
}

function mergeStats(
  current: Readonly<Record<string, WordStat>>,
  incoming: Readonly<Record<string, WordStat>>,
): Record<string, WordStat> {
  const merged: Record<string, WordStat> = { ...current };
  for (const [entryId, stat] of Object.entries(incoming)) {
    const existing = merged[entryId];
    merged[entryId] = existing === undefined ? stat : mergeStat(existing, stat);
  }
  return merged;
}

function mergeProfile(current: Profile | null, incoming: Profile | null): Profile | null {
  if (incoming === null) return current;
  if (current === null) return incoming;
  // Names and avatars are the incoming file's to set, but a career total that
  // went backwards would read as lost progress.
  return {
    ...incoming,
    totalScore: Math.max(current.totalScore, incoming.totalScore),
    bestStreakEver: Math.max(current.bestStreakEver, incoming.bestStreakEver),
  };
}

/**
 * Folds a backup into what the learner already has. Re-importing the same file
 * is a no-op rather than a doubling, because everything merges by id.
 */
export function mergeBackup(current: BackupContents, backup: BackupFile): BackupContents {
  const history = mergeById(current.sessionHistory, backup.sessionHistory)
    .sort((a, b) => (a.endedAt < b.endedAt ? -1 : 1))
    .slice(-MAX_SESSION_HISTORY);

  return {
    profile: mergeProfile(current.profile, backup.profile),
    userEntries: mergeById(current.userEntries, backup.userEntries),
    userDecks: mergeById(current.userDecks, backup.userDecks),
    stats: mergeStats(current.stats, backup.stats),
    sessionHistory: history,
  };
}

/** Everything the learner had, gone. The second confirm lives in the UI. */
export function replaceWith(backup: BackupFile): BackupContents {
  return {
    profile: backup.profile,
    userEntries: backup.userEntries,
    userDecks: backup.userDecks,
    stats: backup.stats,
    sessionHistory: backup.sessionHistory.slice(-MAX_SESSION_HISTORY),
  };
}
