import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  authHeader,
  clearToken,
  DEVICE_TOKEN_KEY,
  ensureToken,
  getToken,
  setToken,
} from './deviceToken';
import { getItem, resetStorageForTests, setItem } from '../store/storage';

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

beforeEach(() => {
  resetStorageForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getToken', () => {
  it('is null before this device has ever registered', () => {
    expect(getToken()).toBeNull();
  });

  it('reads back what was stored', () => {
    setToken(TOKEN);
    expect(getToken()).toBe(TOKEN);
  });

  it('treats a corrupted value as absent rather than 401ing forever', () => {
    setItem(DEVICE_TOKEN_KEY, 'not-a-uuid');
    expect(getToken()).toBeNull();
  });
});

describe('setToken', () => {
  it('refuses a value that is not a uuid', () => {
    expect(() => setToken('nope')).toThrow(/uuid/);
    expect(getItem(DEVICE_TOKEN_KEY)).toBeNull();
  });
});

describe('ensureToken', () => {
  it('generates and persists a token on first need', () => {
    const token = ensureToken();
    expect(token).toMatch(/^[0-9a-f-]{36}$/i);
    expect(getItem(DEVICE_TOKEN_KEY)).toBe(token);
  });

  it('returns the same token on every later call', () => {
    expect(ensureToken()).toBe(ensureToken());
  });

  it('replaces a corrupted token instead of failing', () => {
    setItem(DEVICE_TOKEN_KEY, 'garbage');
    const token = ensureToken();
    expect(token).not.toBe('garbage');
    expect(getToken()).toBe(token);
  });

  it('is the only function that creates an account — reading never does', () => {
    // Opening the stats screen calls getToken; it must not register a device.
    const spy = vi.spyOn(crypto, 'randomUUID');
    getToken();
    authHeader();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('clearToken', () => {
  it('forgets the account on this device', () => {
    setToken(TOKEN);
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe('authHeader', () => {
  it('is null with no account, so a caller cannot send an empty Bearer', () => {
    expect(authHeader()).toBeNull();
  });

  it('carries the bearer token once there is one', () => {
    setToken(TOKEN);
    expect(authHeader()).toEqual({ Authorization: `Bearer ${TOKEN}` });
  });
});

describe('storage discipline', () => {
  it('writes under one namespaced key and nothing else', () => {
    setToken(TOKEN);
    expect(Object.keys(localStorage)).toEqual([DEVICE_TOKEN_KEY]);
  });

  it('survives storage being unavailable, because the app must still play', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    resetStorageForTests();

    const token = ensureToken();
    expect(getToken()).toBe(token);
  });
});
