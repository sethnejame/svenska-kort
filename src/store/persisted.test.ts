import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StorageValue } from 'zustand/middleware';
import type { PersistedGame } from './persisted';
import {
  consumeRecoveryFlag,
  migrate,
  persistedStorage,
  SCHEMA_VERSION,
  STORAGE_KEY,
  withDefaults,
} from './persisted';
import { resetStorageForTests } from './storage';
import { isDue } from '../lib/leitner';

function write(value: unknown): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/**
 * `PersistStorage` allows an async implementation; ours is deliberately not one,
 * because zustand only rehydrates synchronously when `getItem` returns a value.
 */
function read(): StorageValue<PersistedGame> | null {
  const value = persistedStorage.getItem(STORAGE_KEY);
  if (value instanceof Promise) throw new Error('persistedStorage must stay synchronous');
  return value;
}

const STATS = {
  'hej-phrase': {
    entryId: 'hej-phrase',
    seen: 3,
    correct: 2,
    wrong: 1,
    lastSeenAt: '2026-09-20T00:00:00.000Z',
    box: 3 as const,
    lastSeenSession: 4,
  },
};

/** The same stat as schema 1 wrote it, before the session counter existed. */
const V1_STATS = {
  'hej-phrase': {
    entryId: 'hej-phrase',
    seen: 3,
    correct: 2,
    wrong: 1,
    lastSeenAt: '2026-09-20T00:00:00.000Z',
    box: 3 as const,
  },
};

describe('migrate', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageForTests();
    consumeRecoveryFlag();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('passes a current-version blob through untouched', () => {
    const state = { schemaVersion: 1, stats: STATS, totalScore: 120 };
    expect(migrate(state, SCHEMA_VERSION)).toMatchObject(state);
    expect(consumeRecoveryFlag()).toBe(false);
  });

  it('starts the session counter far enough in to make a v1 library due', () => {
    const migrated = migrate({ stats: V1_STATS, totalScore: 120 }, 1);
    const loaded = withDefaults(migrated);

    // Nothing is lost, and every word a v1 learner had is askable at once.
    expect(loaded.stats['hej-phrase']).toMatchObject({ seen: 3, box: 3, lastSeenSession: 0 });
    expect(loaded.totalScore).toBe(120);
    expect(isDue(loaded.stats['hej-phrase'], loaded.sessionCount + 1)).toBe(true);
    expect(consumeRecoveryFlag()).toBe(false);
  });

  it('keeps a future-version blob and warns exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const first = migrate({ stats: STATS, totalScore: 99 }, 99);
    const second = migrate({ stats: STATS, totalScore: 99 }, 99);

    expect(first.stats).toEqual(STATS);
    expect(second.totalScore).toBe(99);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps fields it does not know about', () => {
    const migrated = migrate({ totalScore: 5, somethingNew: ['a'] }, 99);
    expect(migrated).toMatchObject({ totalScore: 5, somethingNew: ['a'] });
  });

  it('recovers to an empty blob when the shape is wrong', () => {
    expect(migrate({ stats: 'not a record' }, SCHEMA_VERSION)).toEqual({});
    expect(consumeRecoveryFlag()).toBe(true);
  });

  /**
   * One case per guard. A field that is absent is fine and a field that is
   * present and right is fine; this pins down that present-and-wrong is the
   * only thing that costs the learner their history.
   */
  it.each([
    ['a blob that is not an object', 'just a string'],
    ['a blob that is an array', ['a']],
    ['a number where a string belongs', { deckId: 7 }],
    ['a string where a number belongs', { totalScore: 'lots' }],
    ['a stat that is missing a field', { stats: { a: { entryId: 'a', seen: 1 } } }],
    ['a leitner box outside 1-5', { stats: { a: { ...STATS['hej-phrase'], box: 6 } } }],
    ['a session history that is not an array', { sessionHistory: { id: 'a' } }],
    ['a session result with a wrong field type', { sessionHistory: [{ id: 1 }] }],
    ['a profile that is not an object', { profile: 'me' }],
    ['a profile missing a field', { profile: { displayName: 'Ada' } }],
    ['a pool holding something other than ids', { pool: [1, 2] }],
    ['a non-null, non-number endedAt', { endedAt: 'later' }],
  ])('recovers from %s', (_label, blob) => {
    expect(migrate(blob, SCHEMA_VERSION)).toEqual({});
    expect(consumeRecoveryFlag()).toBe(true);
  });

  it.each([
    ['an explicit null profile', { profile: null }],
    ['an explicit null deckId', { deckId: null }],
    ['an explicit null endedAt', { endedAt: null }],
    ['an empty stats record', { stats: {} }],
    ['an empty session history', { sessionHistory: [] }],
    ['a full, valid blob', { stats: STATS, pool: ['a'], totalScore: 1, endedAt: 2 }],
  ])('keeps %s', (_label, blob) => {
    expect(migrate(blob, SCHEMA_VERSION)).toEqual(blob);
    expect(consumeRecoveryFlag()).toBe(false);
  });
});

describe('withDefaults', () => {
  it('fills every missing field', () => {
    expect(withDefaults({})).toEqual({
      schemaVersion: SCHEMA_VERSION,
      stats: {},
      sessionCount: 0,
      sessionHistory: [],
      profile: null,
      bestStreakEver: 0,
      totalScore: 0,
      deckId: null,
      pool: [],
      streak: 0,
      bestStreakInSession: 0,
      sessionScore: 0,
      answered: 0,
      correct: 0,
      startedAt: 0,
      endedAt: null,
    });
  });

  it('prefers what was stored', () => {
    const filled = withDefaults({ totalScore: 42, stats: STATS, endedAt: 1000 });
    expect(filled.totalScore).toBe(42);
    expect(filled.stats).toEqual(STATS);
    expect(filled.endedAt).toBe(1000);
  });
});

describe('persistedStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageForTests();
    consumeRecoveryFlag();
  });

  it('returns null for a key that was never written', () => {
    expect(read()).toBeNull();
    expect(consumeRecoveryFlag()).toBe(false);
  });

  it('reads back what it wrote', () => {
    persistedStorage.setItem(STORAGE_KEY, {
      state: withDefaults({ totalScore: 42 }),
      version: SCHEMA_VERSION,
    });

    expect(read()?.state.totalScore).toBe(42);
  });

  it('recovers from a blob that is not JSON instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{{{');

    expect(read()).toBeNull();
    expect(consumeRecoveryFlag()).toBe(true);
  });

  it('recovers from JSON that is not an envelope', () => {
    write('just a string');

    expect(read()).toBeNull();
    expect(consumeRecoveryFlag()).toBe(true);
  });

  it('loads a schemaVersion 99 blob without wiping it', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    write({ state: { stats: STATS, totalScore: 77, bestStreakEver: 9 }, version: 99 });

    const loaded = read();

    expect(loaded?.state.stats).toEqual(STATS);
    expect(loaded?.state.totalScore).toBe(77);
    expect(loaded?.state.bestStreakEver).toBe(9);
    // Migration happened on read, so zustand is handed this build's version.
    expect(loaded?.version).toBe(SCHEMA_VERSION);
    expect(consumeRecoveryFlag()).toBe(false);
    vi.restoreAllMocks();
  });

  it('treats a missing envelope version as the current one', () => {
    write({ state: { totalScore: 3 } });
    expect(read()?.state.totalScore).toBe(3);
  });

  it('removes a key', () => {
    persistedStorage.setItem(STORAGE_KEY, { state: withDefaults({}), version: SCHEMA_VERSION });
    persistedStorage.removeItem(STORAGE_KEY);
    expect(read()).toBeNull();
  });

  it('swallows a write that cannot be serialised', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(() => {
      persistedStorage.setItem(STORAGE_KEY, {
        state: withDefaults({}),
        version: SCHEMA_VERSION,
        // A circular reference is the cheapest way to make JSON.stringify throw.
        ...(cyclic as object),
      });
    }).not.toThrow();
  });
});
