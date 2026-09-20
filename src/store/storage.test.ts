import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getItem, isMemoryOnly, removeItem, resetStorageForTests, setItem } from './storage';

const KEY = 'storage-test';

describe('storage', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    resetStorageForTests();
  });

  it('round-trips through real storage when it works', () => {
    setItem(KEY, 'hej');
    expect(getItem(KEY)).toBe('hej');
    expect(localStorage.getItem(KEY)).toBe('hej');
    expect(isMemoryOnly()).toBe(false);

    removeItem(KEY);
    expect(getItem(KEY)).toBeNull();
  });

  it('falls back to memory when the storage probe throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    setItem(KEY, 'hej');

    expect(isMemoryOnly()).toBe(true);
    // The value is still readable for the rest of the session, just not durable.
    expect(getItem(KEY)).toBe('hej');

    removeItem(KEY);
    expect(getItem(KEY)).toBeNull();
  });

  it('keeps serving reads after a mid-session read failure', () => {
    setItem(KEY, 'hej');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });

    expect(getItem(KEY)).toBe('hej');
    expect(isMemoryOnly()).toBe(true);
  });
});
