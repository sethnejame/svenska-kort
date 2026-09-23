/**
 * Transfer codes — moving an account to a second device.
 *
 * No email, no password reset: a learner who wants their account on a second
 * device gets an 8-character code, typed in once, bound to their `device.id`.
 * This is also the only supported way to have one account on two devices —
 * claiming overwrites the device's `token_hash`, so the old device is simply
 * unregistered afterwards. There is no dual-token support and nothing here
 * merges history, which is why P07 does not attempt that either.
 *
 * The claim path is unauthenticated and code-guessable in principle, so two
 * things about it are load-bearing:
 *
 * 1. Invalid, expired and used codes must answer identically. All three fail
 *    the exact same `WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`
 *    predicate on the same indexed lookup — one index seek, one row fetched or
 *    not — so there is no separate branch per cause to keep in sync and no
 *    query shape that differs by why a code failed.
 * 2. The claim rate limiter runs BEFORE that lookup and is allowed to be
 *    faster: refusing a rate-limited caller is not one of the three cases the
 *    indistinguishability requirement covers, and it must not spend a D1 read
 *    on `transfer_code` at all — that read is the resource being protected.
 */
import { TRANSFER_CODE_TTL_MS, UNAMBIGUOUS_ALPHABET } from '../../shared/constants';
import { sha256Hex } from './auth';
import type { Device } from './auth';

export interface TransferDeps {
  db: D1Database;
  now: number;
  uuid: () => string;
}

const CODE_LENGTH = 8;

/** Read aloud as two groups of four. */
function formatted(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Undoes `formatted`, and folds whatever case or spacing a learner typed. */
function normalizeCode(raw: string): string {
  return raw.replace(/[-\s]/g, '').toUpperCase();
}

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (const byte of bytes) out += UNAMBIGUOUS_ALPHABET[byte % UNAMBIGUOUS_ALPHABET.length];
  return out;
}

export interface CreatedCode {
  code: string;
  expiresAt: string;
}

/**
 * Issues a new code for an authenticated device.
 *
 * A device can hold at most one live code: creating a new one invalidates
 * whatever it made before, so re-opening the "use on another device" panel
 * never leaves a stale, still-claimable code behind.
 */
export async function createCode(device: Device, deps: TransferDeps): Promise<CreatedCode> {
  const code = randomCode();
  const codeHash = await sha256Hex(code);
  const nowIso = new Date(deps.now).toISOString();
  const expiresAt = new Date(deps.now + TRANSFER_CODE_TTL_MS).toISOString();

  await deps.db.batch([
    deps.db
      .prepare('UPDATE transfer_code SET used_at = ? WHERE device_id = ? AND used_at IS NULL')
      .bind(nowIso, device.id),
    deps.db
      .prepare(
        `INSERT INTO transfer_code (code_hash, device_id, expires_at, used_at, created_at)
         VALUES (?, ?, ?, NULL, ?)`,
      )
      .bind(codeHash, device.id, expiresAt, nowIso),
  ]);

  return { code: formatted(code), expiresAt };
}

/** Every claim failure says the same thing, whatever the cause. */
export const CLAIM_GENERIC_ERROR = 'Koden är ogiltig eller har gått ut.';
export const RATE_LIMIT_ERROR = 'För många försök. Vänta en minut och försök igen.';

export type ClaimOutcome =
  | { ok: true; token: string }
  | { ok: false; status: 400 | 429; error: string };

const CLAIM_LIMIT_PER_WINDOW = 5;
const RATE_WINDOW_MS = 60_000;

/**
 * True and counted as this window's attempt, or false and left uncounted —
 * a caller that is already over the limit does not get to spend down a
 * neighbor's budget by retrying.
 */
async function withinRateLimit(ipHash: string, deps: TransferDeps): Promise<boolean> {
  const windowStart = new Date(Math.floor(deps.now / RATE_WINDOW_MS) * RATE_WINDOW_MS).toISOString();
  const nowIso = new Date(deps.now).toISOString();

  const existing = await deps.db
    .prepare('SELECT window_start, attempts FROM transfer_claim_attempt WHERE ip_hash = ?')
    .bind(ipHash)
    .first<{ window_start: string; attempts: number }>();

  if (existing === null) {
    await deps.db
      .prepare(
        `INSERT INTO transfer_claim_attempt (ip_hash, window_start, attempts, updated_at)
         VALUES (?, ?, 1, ?)`,
      )
      .bind(ipHash, windowStart, nowIso)
      .run();
    return true;
  }

  // A new minute resets the counter in place, the same way `usage` (0001)
  // resets on a new day: one row per key, never one row per attempt.
  if (existing.window_start !== windowStart) {
    await deps.db
      .prepare(
        'UPDATE transfer_claim_attempt SET window_start = ?, attempts = 1, updated_at = ? WHERE ip_hash = ?',
      )
      .bind(windowStart, nowIso, ipHash)
      .run();
    return true;
  }

  if (existing.attempts >= CLAIM_LIMIT_PER_WINDOW) return false;

  await deps.db
    .prepare('UPDATE transfer_claim_attempt SET attempts = attempts + 1, updated_at = ? WHERE ip_hash = ?')
    .bind(nowIso, ipHash)
    .run();
  return true;
}

/**
 * Claims a code: on success, a new device token bound to the code's original
 * `device.id`. The caller never learns anything from the response about
 * whether a code never existed, expired, or was already used.
 */
export async function claimCode(rawCode: string, ipHash: string, deps: TransferDeps): Promise<ClaimOutcome> {
  const allowed = await withinRateLimit(ipHash, deps);
  if (!allowed) return { ok: false, status: 429, error: RATE_LIMIT_ERROR };

  const codeHash = await sha256Hex(normalizeCode(rawCode));
  const nowIso = new Date(deps.now).toISOString();

  const row = await deps.db
    .prepare(
      `SELECT device_id FROM transfer_code
        WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?
        LIMIT 1`,
    )
    .bind(codeHash, nowIso)
    .first<{ device_id: string }>();

  if (row === null) return { ok: false, status: 400, error: CLAIM_GENERIC_ERROR };

  const token = deps.uuid();
  const tokenHash = await sha256Hex(token);

  const results = await deps.db.batch<{ id: string }>([
    // Re-guarded on the same predicate as the SELECT above: two concurrent
    // claims of the same code can both pass that read, and only one of them
    // may flip `used_at` and rotate the token.
    deps.db
      .prepare(
        `UPDATE transfer_code SET used_at = ?
          WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(nowIso, codeHash, nowIso),
    deps.db.prepare('UPDATE device SET token_hash = ? WHERE id = ?').bind(tokenHash, row.device_id),
  ]);

  const claimed = results[0];
  if (claimed === undefined || claimed.meta.changes !== 1) {
    return { ok: false, status: 400, error: CLAIM_GENERIC_ERROR };
  }

  return { ok: true, token };
}
