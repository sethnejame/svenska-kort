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
});

describe('withDefaults', () => {
  it('fills every missing field', () => {
    expect(withDefaults({})).toEqual({
      schemaVersion: SCHEMA_VERSION,
      stats: {},
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
