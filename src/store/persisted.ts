import type { PersistStorage, StorageValue } from 'zustand/middleware';
import type { LeitnerBox, Profile, SessionResult, WordStat } from '../types/progress';
import { getItem, removeItem, setItem } from './storage';

export const STORAGE_KEY = 'svenska-kort:v1';
export const SCHEMA_VERSION = 1;
export const MAX_SESSION_HISTORY = 50;

/**
 * These guards are written out rather than declared with a schema library. This
 * is the one validator on the startup path, so whatever it costs is paid by
 * every cold start before the first card can be drawn; the shape it checks is
 * flat and entirely optional, which is not worth a dependency an order of
 * magnitude larger than the app's own code. The deck and backup schemas still
 * use one, because those load only with the screens that need them.
 */
type Guard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';

/** Absent and present-but-valid both pass; present-but-wrong is what fails. */
const optional =
  <T>(guard: Guard<T>): Guard<T | undefined> =>
  (value): value is T | undefined =>
    value === undefined || guard(value);

const nullable =
  <T>(guard: Guard<T>): Guard<T | null> =>
  (value): value is T | null =>
    value === null || guard(value);

const arrayOf =
  <T>(guard: Guard<T>): Guard<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.every((item) => guard(item));

const recordOf =
  <T>(guard: Guard<T>): Guard<Record<string, T>> =>
  (value): value is Record<string, T> =>
    isRecord(value) && Object.values(value).every((item) => guard(item));

/** Every listed field must hold, and anything unlisted is left alone. */
const objectOf =
  <T>(fields: { [K in keyof T]-?: Guard<T[K]> }): Guard<T> =>
  (value): value is T =>
    isRecord(value) &&
    Object.entries(fields).every(([key, guard]) => (guard as Guard<unknown>)(value[key]));

const isLeitnerBox = (value: unknown): value is LeitnerBox =>
  value === 1 || value === 2 || value === 3 || value === 4 || value === 5;

const isWordStat = objectOf<WordStat>({
  entryId: isString,
  seen: isNumber,
  correct: isNumber,
  wrong: isNumber,
  lastSeenAt: isString,
  box: isLeitnerBox,
});

const isSessionResult = objectOf<SessionResult>({
  id: isString,
  deckId: isString,
  startedAt: isString,
  endedAt: isString,
  answered: isNumber,
  correct: isNumber,
  bestStreak: isNumber,
  score: isNumber,
});

const isProfile = objectOf<Profile>({
  displayName: isString,
  avatarSeed: isString,
  createdAt: isString,
  totalScore: isNumber,
  bestStreakEver: isNumber,
});

/**
 * Every field is optional on the way in. A blob written by a newer build may be
 * missing things this build expects, or carry things it does not know about;
 * neither is a reason to throw away a learner's history.
 */
interface KnownFields {
  schemaVersion?: number | undefined;
  stats?: Record<string, WordStat> | undefined;
  sessionHistory?: SessionResult[] | undefined;
  profile?: Profile | null | undefined;
  bestStreakEver?: number | undefined;
  totalScore?: number | undefined;
  deckId?: string | null | undefined;
  pool?: string[] | undefined;
  streak?: number | undefined;
  bestStreakInSession?: number | undefined;
  sessionScore?: number | undefined;
  answered?: number | undefined;
  correct?: number | undefined;
  startedAt?: number | undefined;
  endedAt?: number | null | undefined;
}

/** The known fields, plus whatever a newer build happened to write alongside them. */
export type PersistedState = KnownFields & Record<string, unknown>;

const isKnownFields = objectOf<KnownFields>({
  schemaVersion: optional(isNumber),
  stats: optional(recordOf(isWordStat)),
  sessionHistory: optional(arrayOf(isSessionResult)),
  profile: optional(nullable(isProfile)),
  bestStreakEver: optional(isNumber),
  totalScore: optional(isNumber),
  deckId: optional(nullable(isString)),
  pool: optional(arrayOf(isString)),
  streak: optional(isNumber),
  bestStreakInSession: optional(isNumber),
  sessionScore: optional(isNumber),
  answered: optional(isNumber),
  correct: optional(isNumber),
  startedAt: optional(isNumber),
  endedAt: optional(nullable(isNumber)),
});

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
  if (!isRecord(persisted) || !isKnownFields(persisted)) {
    recovered = true;
    return {};
  }

  switch (version) {
    case SCHEMA_VERSION:
      return persisted;
    default:
      if (version > SCHEMA_VERSION && !warnedAboutFutureVersion) {
        warnedAboutFutureVersion = true;
        console.warn(
          `svenska-kort: stored data is schema version ${version}, this build understands ${SCHEMA_VERSION}. Keeping the data and filling unknown fields with defaults.`,
        );
      }
      // Older versions land here too. Every field this build knows about is
      // optional and unknown ones pass through, so nothing is dropped.
      return persisted;
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
