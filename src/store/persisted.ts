import { z } from 'zod';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { Profile, SessionResult, WordStat } from '../types/progress';
import { getItem, removeItem, setItem } from './storage';

export const STORAGE_KEY = 'svenska-kort:v1';
export const SCHEMA_VERSION = 1;
export const MAX_SESSION_HISTORY = 50;

const leitnerBoxSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const wordStatSchema = z.object({
  entryId: z.string(),
  seen: z.number(),
  correct: z.number(),
  wrong: z.number(),
  lastSeenAt: z.string(),
  box: leitnerBoxSchema,
});

const sessionResultSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  answered: z.number(),
  correct: z.number(),
  bestStreak: z.number(),
  score: z.number(),
});

const profileSchema = z.object({
  displayName: z.string(),
  avatarSeed: z.string(),
  createdAt: z.string(),
  totalScore: z.number(),
  bestStreakEver: z.number(),
});

/**
 * Every field is optional on the way in. A blob written by a newer build may be
 * missing things this build expects, or carry things it does not know about;
 * neither is a reason to throw away a learner's history.
 */
const persistedStateSchema = z.looseObject({
  schemaVersion: z.number().optional(),
  stats: z.record(z.string(), wordStatSchema).optional(),
  sessionHistory: z.array(sessionResultSchema).optional(),
  profile: profileSchema.nullable().optional(),
  bestStreakEver: z.number().optional(),
  totalScore: z.number().optional(),
  deckId: z.string().nullable().optional(),
  pool: z.array(z.string()).optional(),
  streak: z.number().optional(),
  bestStreakInSession: z.number().optional(),
  sessionScore: z.number().optional(),
  answered: z.number().optional(),
  correct: z.number().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().nullable().optional(),
});

export type PersistedState = z.infer<typeof persistedStateSchema>;

export interface PersistedGame {
  schemaVersion: number;
  stats: Record<string, WordStat>;
  sessionHistory: SessionResult[];
  profile: Profile | null;
  bestStreakEver: number;
  totalScore: number;
  deckId: string | null;
  pool: string[];
  streak: number;
  bestStreakInSession: number;
  sessionScore: number;
  answered: number;
  correct: number;
  startedAt: number;
  endedAt: number | null;
}

let recovered = false;

/** True once if the stored blob was unreadable and defaults were used instead. */
export function consumeRecoveryFlag(): boolean {
  const was = recovered;
  recovered = false;
  return was;
}

let warnedAboutFutureVersion = false;

/**
 * A real switch, even with nothing to migrate yet, so that adding version 2 is
 * a case statement rather than a redesign.
 */
export function migrate(persisted: unknown, version: number): PersistedState {
  const parsed = persistedStateSchema.safeParse(persisted);
  if (!parsed.success) {
    recovered = true;
    return {};
  }

  switch (version) {
    case SCHEMA_VERSION:
      return parsed.data;
    default:
      if (version > SCHEMA_VERSION && !warnedAboutFutureVersion) {
        warnedAboutFutureVersion = true;
        console.warn(
          `svenska-kort: stored data is schema version ${version}, this build understands ${SCHEMA_VERSION}. Keeping the data and filling unknown fields with defaults.`,
        );
      }
      // Older versions land here too. Every field this build knows about is
      // optional and unknown ones pass through, so nothing is dropped.
      return parsed.data;
  }
}

/** Fills in whatever the stored blob did not carry. */
export function withDefaults(persisted: PersistedState): PersistedGame {
  return {
    schemaVersion: SCHEMA_VERSION,
    stats: persisted.stats ?? {},
    sessionHistory: persisted.sessionHistory ?? [],
    profile: persisted.profile ?? null,
    bestStreakEver: persisted.bestStreakEver ?? 0,
    totalScore: persisted.totalScore ?? 0,
    deckId: persisted.deckId ?? null,
    pool: persisted.pool ?? [],
    streak: persisted.streak ?? 0,
    bestStreakInSession: persisted.bestStreakInSession ?? 0,
    sessionScore: persisted.sessionScore ?? 0,
    answered: persisted.answered ?? 0,
    correct: persisted.correct ?? 0,
    startedAt: persisted.startedAt ?? 0,
    endedAt: persisted.endedAt ?? null,
  };
}

/**
 * Reading is wrapped end to end: a blob that is not JSON, or that does not
 * survive the parse, becomes `null` and the store starts from defaults with
 * `storageRecovered` set. Rehydration never throws into React.
 */
export const persistedStorage: PersistStorage<PersistedGame> = {
  getItem(name) {
    try {
      const raw = getItem(name);
      if (raw === null) return null;

      const envelope: unknown = JSON.parse(raw);
      if (typeof envelope !== 'object' || envelope === null) {
        recovered = true;
        return null;
      }

      const { state, version } = envelope as { state?: unknown; version?: unknown };
      const storedVersion = typeof version === 'number' ? version : SCHEMA_VERSION;
      const migrated = withDefaults(migrate(state, storedVersion));

      // Migration already happened here, so the version handed back is this
      // build's — zustand has nothing left to do.
      return { state: migrated, version: SCHEMA_VERSION } satisfies StorageValue<PersistedGame>;
    } catch {
      recovered = true;
      return null;
    }
  },

  setItem(name, value) {
    try {
      setItem(name, JSON.stringify(value));
    } catch {
      // storage.ts already fell back to memory; nothing further to do here.
    }
  },

  removeItem(name) {
    removeItem(name);
  },
};
