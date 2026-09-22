/**
 * The device token — this app's entire notion of an account.
 *
 * Generated on the client, sent as a bearer token, and turned into a row by the
 * Worker the first time it sees one. There is no signup, no password and no
 * email, so this string is the only thing standing between a learner and their
 * leaderboard history: losing it means losing the account, which is exactly what
 * P08's transfer codes exist to work around.
 *
 * It is a credential, so it goes through the storage module like everything else
 * and is never put in a URL, a log, or an error message.
 */
import { getItem, removeItem, setItem } from '../store/storage';

export const DEVICE_TOKEN_KEY = 'svenska-kort:device:v1';

/** The shape `crypto.randomUUID()` produces, and the only shape the Worker accepts. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The stored token, or null when this device has never registered.
 *
 * Null is a normal state, not an error: the app is fully playable without an
 * account, and `CompositeScoreStore` reads this to decide whether there is a
 * remote to talk to at all.
 */
export function getToken(): string | null {
  const stored = getItem(DEVICE_TOKEN_KEY);
  if (stored === null) return null;
  // A corrupted or hand-edited value would 401 on every request forever.
  // Treating it as absent lets the next `ensureToken` replace it.
  return UUID.test(stored) ? stored : null;
}

/** Used by P08 when a transfer code hands this device an existing account. */
export function setToken(token: string): void {
  if (!UUID.test(token)) {
    throw new Error('Refusing to store a device token that is not a uuid');
  }
  setItem(DEVICE_TOKEN_KEY, token);
}

/**
 * The token for this device, generating one on first need.
 *
 * Deliberately separate from `getToken`: a read must never have the side effect
 * of creating an account, or merely opening the stats screen would register one.
 */
export function ensureToken(): string {
  const existing = getToken();
  if (existing !== null) return existing;

  const token = crypto.randomUUID();
  setToken(token);
  return token;
}

/** Forgets the account on this device. Nothing server-side is deleted. */
export function clearToken(): void {
  removeItem(DEVICE_TOKEN_KEY);
}

/** `Authorization` for an authenticated call, or null when there is no account. */
export function authHeader(): Record<string, string> | null {
  const token = getToken();
  return token === null ? null : { Authorization: `Bearer ${token}` };
}
