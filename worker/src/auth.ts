/**
 * Device-token auth. A device is the account: no email, no password, no OAuth.
 *
 * The bearer token is a client-generated UUID. The server stores only its
 * SHA-256, so a dump of the `device` table does not yield a usable credential.
 *
 * SHA-256 rather than bcrypt/argon2/PBKDF2 is a platform constraint, not a
 * shortcut: a Worker request gets 10 ms of CPU, and a password KDF with a real
 * work factor cannot run in that. The token is also not a password — it is
 * 122 bits of `crypto.randomUUID()` entropy that was never chosen by a human,
 * so there is nothing to brute-force offline and no work factor to need.
 */
import { LAST_SEEN_INTERVAL_MS } from '../../shared/constants';
import { normalizeDisplayName } from '../../shared/api';

export interface Device {
  id: string;
  display_name: string;
  avatar_seed: string;
  is_admin: number;
  is_banned: number;
  created_at: string;
  last_seen_at: string;
  total_score: number;
  best_streak: number;
  /** Best *unflagged* session score, the input to histogram rank. Added by 0002. */
  best_score: number;
  distinct_correct: number;
  decks_played: string;
}

/** Thrown to be turned into a response by the caller; never carries the token. */
export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly body: string,
  ) {
    super(body);
    this.name = 'AuthError';
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  let out = '';
  for (const byte of new Uint8Array(digest)) {
    // `padStart` is the whole point: a bare `toString(16)` drops the leading zero
    // on a byte under 0x10 and produces a 63-character hash that still looks
    // plausible, which would only surface as a lookup that never matches.
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * The raw token out of the header.
 *
 * A UUID is the only accepted shape. Rejecting anything else here means a
 * malformed `Authorization` header never reaches a query, and the 36-character
 * bound stops an oversized header from being hashed at all.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SCHEME = 'Bearer ';

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (header === null || !header.startsWith(SCHEME)) return null;

  const token = header.slice(SCHEME.length);
  return UUID.test(token) ? token : null;
}

export interface Registration {
  displayName: string;
  avatarSeed: string;
}

export interface AuthDeps {
  db: D1Database;
  now: number;
  /** Injected so a test can assert the id rather than match a pattern. */
  uuid: () => string;
}

/**
 * The device behind this request, creating it on first sight.
 *
 * There is no separate signup endpoint: first sight *is* registration. A client
 * that has never called before sends a token nobody has seen, and gets a row.
 *
 * Costs one indexed row read on the common path, plus one write per device per
 * hour for `last_seen_at`, plus one write on the single request that registers.
 */
export async function requireDevice(
  request: Request,
  deps: AuthDeps,
  registration?: Registration,
): Promise<Device> {
  const token = bearerToken(request);
  // 401, never 500: a missing or malformed token is an ordinary thing for a
  // client to do, not an internal failure.
  if (token === null) throw new AuthError(401, 'Unauthorized');

  const tokenHash = await sha256Hex(token);
  const existing = await deps.db
    .prepare(
      `SELECT id, display_name, avatar_seed, is_admin, is_banned, created_at,
              last_seen_at, total_score, best_streak, best_score,
              distinct_correct, decks_played
         FROM device WHERE token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<Device>();

  if (existing !== null) {
    if (existing.is_banned === 1) throw new AuthError(403, 'Forbidden');
    await touchLastSeen(deps, existing);
    return existing;
  }

  return register(deps, tokenHash, registration);
}

/**
 * Bounded to one write per device per hour. Without the guard this is a write on
 * every authenticated request, which is the whole daily budget spent on a
 * timestamp no screen displays to the minute.
 */
async function touchLastSeen(deps: AuthDeps, device: Device): Promise<void> {
  const last = Date.parse(device.last_seen_at);
  // An unparseable timestamp means the row predates this code or was edited by
  // hand; treat it as stale and overwrite rather than skipping forever.
  const stale = Number.isNaN(last) || deps.now - last >= LAST_SEEN_INTERVAL_MS;
  if (!stale) return;

  const iso = new Date(deps.now).toISOString();
  await deps.db.prepare('UPDATE device SET last_seen_at = ? WHERE id = ?').bind(iso, device.id).run();
  device.last_seen_at = iso;
}

async function register(
  deps: AuthDeps,
  tokenHash: string,
  registration: Registration | undefined,
): Promise<Device> {
  const iso = new Date(deps.now).toISOString();
  const device: Device = {
    id: deps.uuid(),
    // A learner who has never opened the profile form still gets a row, because
    // the alternative is failing their first session submission over a display
    // name they were never asked for. 'Du' is what the app already shows.
    display_name: normalizeDisplayName(registration?.displayName ?? 'Du'),
    avatar_seed: registration?.avatarSeed ?? 'du',
    is_admin: 0,
    is_banned: 0,
    created_at: iso,
    last_seen_at: iso,
    total_score: 0,
    best_streak: 0,
    best_score: 0,
    distinct_correct: 0,
    decks_played: '[]',
  };

  // `ON CONFLICT DO NOTHING` plus `RETURNING` makes first sight safe to race.
  // A client opening the app can easily fire two authenticated calls at once
  // with a token neither has registered yet; without this the loser hits the
  // unique index on `token_hash` and the learner sees a 500 on their first ever
  // request. RETURNING is empty exactly when the other request won.
  const inserted = await deps.db
    .prepare(
      `INSERT INTO device (id, token_hash, display_name, avatar_seed, is_admin, is_banned,
                           created_at, last_seen_at, total_score, best_streak, best_score,
                           distinct_correct, decks_played)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, 0, 0, 0, 0, '[]')
       ON CONFLICT(token_hash) DO NOTHING
       RETURNING id`,
    )
    .bind(
      device.id,
      tokenHash,
      device.display_name,
      device.avatar_seed,
      device.created_at,
      device.last_seen_at,
    )
    .first<{ id: string }>();

  if (inserted !== null) return device;

  // The other request registered it. Read back its row rather than returning a
  // device object whose id was never stored.
  const winner = await deps.db
    .prepare(
      `SELECT id, display_name, avatar_seed, is_admin, is_banned, created_at,
              last_seen_at, total_score, best_streak, best_score,
              distinct_correct, decks_played
         FROM device WHERE token_hash = ? LIMIT 1`,
    )
    .bind(tokenHash)
    .first<Device>();

  // Only reachable if the row vanished between the two statements, which needs
  // a concurrent delete that nothing in this API performs.
  if (winner === null) throw new AuthError(401, 'Unauthorized');
  if (winner.is_banned === 1) throw new AuthError(403, 'Forbidden');
  return winner;
}
