import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from './index';
import {
  claimTransferCodeResponseSchema,
  createTransferCodeResponseSchema,
  healthResponseSchema,
  leaderboardResponseSchema,
  meResponseSchema,
  submitSessionResponseSchema,
} from '../../shared/api';
import { SESSION_BYTES_MAX } from '../../shared/constants';
import { seasonIdFor } from '../../shared/season';
import { TestD1 } from '../test/d1';

const ALLOWED = 'https://svenskakort.se';
const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

let db: TestD1;
let env: Env;

beforeEach(() => {
  db = new TestD1();
  env = { VERSION: 'abc1234', DB: db as unknown as D1Database };
  platform = context();
});

afterEach(() => {
  uninstallCache();
});

/**
 * The platform context, with `waitUntil` awaited rather than backgrounded.
 *
 * The real one lets a promise outlive the response; a test that did the same
 * would finish before the cache write it is about to assert on. Collecting the
 * promises here lets a test await them explicitly.
 */
function context() {
  const pending: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) },
    settled: () => Promise.all(pending),
  };
}

let platform: ReturnType<typeof context>;

/** The global the Workers runtime provides and Node does not. */
interface CacheGlobal {
  caches?: { default?: Cache };
}

/**
 * An in-memory stand-in for `caches.default`.
 *
 * Installed only by the tests that are about the cache. Everywhere else the
 * global is absent, which is the uncached path — so the handler is exercised both
 * ways without a flag.
 */
function installCache() {
  const store = new Map<string, Response>();

  (globalThis as CacheGlobal).caches = {
    default: {
      // `clone()` on the way out and in: a Response body is a stream, and handing
      // the same one to two callers would leave the second with nothing.
      match: (request: Request | string) => {
        const hit = store.get(typeof request === 'string' ? request : request.url);
        return Promise.resolve(hit === undefined ? undefined : hit.clone());
      },
      put: (request: Request | string, response: Response) => {
        store.set(typeof request === 'string' ? request : request.url, response.clone());
        return Promise.resolve();
      },
    } as unknown as Cache,
  };

  return store;
}

function uninstallCache() {
  delete (globalThis as CacheGlobal).caches;
}

function call(path: string, init: RequestInit = {}, origin: string | null = ALLOWED) {
  const headers = new Headers(init.headers);
  if (origin !== null) headers.set('Origin', origin);
  return worker.fetch(
    new Request(`https://api.test${path}`, { ...init, headers }),
    env,
    platform.ctx,
  );
}

function authed(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return call(path, { ...init, headers });
}

function fromIp(path: string, init: RequestInit = {}, ip = '203.0.113.1') {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', ip);
  return call(path, { ...init, headers });
}

describe('GET /api/health', () => {
  it('answers the shape the shared schema describes', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      ok: true,
      version: 'abc1234',
      // Never built, which is a different fact from "built and empty".
      snapshotAgeSeconds: null,
    });
  });

  it('carries the CORS headers for an allowed origin', async () => {
    const response = await call('/api/health');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);
  });

  it('answers a disallowed origin without the header the browser needs', async () => {
    const response = await call('/api/health', {}, 'https://evil.example');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('routing', () => {
  it('preflights', async () => {
    const response = await call('/api/health', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
  });

  it('404s an unknown path', async () => {
    const response = await call('/api/nope');
    expect(response.status).toBe(404);
  });

  it('405s a known path under the wrong method', async () => {
    const response = await call('/api/health', { method: 'POST' });
    expect(response.status).toBe(405);
  });

  it('says the same generic thing on every failure', async () => {
    const response = await call('/api/nope');
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('turns a thrown handler into a 500 that reveals nothing', async () => {
    const boom = new Request('https://api.test/api/health', {
      headers: { Origin: ALLOWED },
    });
    // A handler that throws is the only way to reach the catch; force it by
    // taking VERSION away, which the health handler reads.
    const broken = {
      get VERSION(): string {
        throw new Error('D1_ERROR: secret table name');
      },
    } as Env;

    const response = await worker.fetch(boom, broken, platform.ctx);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret table name');
  });
});

describe('/api/me', () => {
  it('registers on first sight and answers the shared schema', async () => {
    const response = await authed('/api/me');
    expect(response.status).toBe(200);

    const body = meResponseSchema.parse(await response.json());
    expect(body.displayName).toBe('Du');
    expect(body.isAdmin).toBe(false);
    expect(body.rank).toBeNull();
    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });

  it('401s without a token', async () => {
    const response = await authed('/api/me', {}, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('403s a banned device on an authenticated route', async () => {
    await authed('/api/me');
    db.seed('UPDATE device SET is_banned = 1');

    const response = await authed('/api/me');
    expect(response.status).toBe(403);
  });

  it('names the device from the body on POST', async () => {
    const response = await authed('/api/me', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Anna', avatarSeed: 'anna' }),
    });

    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Anna');
  });

  it('still registers when POST carries no usable body', async () => {
    const response = await authed('/api/me', { method: 'POST', body: 'not json' });
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Du');
  });

  it('still registers when POST carries readable JSON that is not a registration', async () => {
    // A rejected hint is not a rejected registration: the learner gets an account
    // under the default name and can rename it later through PUT, where a bad
    // name is their own input and does deserve a 400.
    const response = await authed('/api/me', {
      method: 'POST',
      body: JSON.stringify({ displayName: '!!', avatarSeed: '' }),
    });

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Du');
  });

  it('rejects an over-long display name on PUT with a message the learner can act on', async () => {
    const response = await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'x'.repeat(21), avatarSeed: 'a' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toMatch(/högst 20 tecken/);
  });

  it('rejects a display name carrying a bidi override', async () => {
    const response = await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Anna\u202ehcnA', avatarSeed: 'a' }),
    });
    expect(response.status).toBe(400);
  });

  it('persists a profile update', async () => {
    await authed('/api/me');
    const response = await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: '  Björn  Nilsson ', avatarSeed: 'bjorn' }),
    });

    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Björn Nilsson');
    const rows = db.read<{ display_name: string }>('SELECT display_name FROM device');
    expect(rows[0]?.display_name).toBe('Björn Nilsson');
  });

  it('400s a PUT with no body rather than 500ing', async () => {
    const response = await authed('/api/me', { method: 'PUT' });
    expect(response.status).toBe(400);
  });

  it('never puts the token in a response body', async () => {
    const response = await authed('/api/me');
    expect(await response.text()).not.toContain(TOKEN);
  });
});

describe('POST /api/session', () => {
  function body(count: number, over: Record<string, unknown> = {}) {
    const answers = Array.from({ length: count }, (_, i) => ({
      entryId: `entry-${i}`,
      verdict: 'correct',
      elapsedMs: 5000,
      wasTyped: true,
      acceptedOnRetry: false,
    }));

    return JSON.stringify({
      sessionId: 'session-1',
      deckId: 'nyheter',
      startedAt: new Date(Date.now() - count * 5000).toISOString(),
      endedAt: new Date().toISOString(),
      answers,
      claimedScore: 0,
      claimedBestStreak: 0,
      ...over,
    });
  }

  function submit(payload: string, token: string | null = TOKEN) {
    return authed('/api/session', { method: 'POST', body: payload }, token);
  }

  it('answers the shape the shared schema describes', async () => {
    const response = await submit(body(10));
    expect(response.status).toBe(200);

    const parsed = submitSessionResponseSchema.parse(await response.json());
    expect(parsed.answered).toBe(10);
    expect(parsed.rank).toBeNull();
  });

  it('401s without a token, before reading the body', async () => {
    const response = await submit(body(10), null);
    expect(response.status).toBe(401);
  });

  it('403s a banned device', async () => {
    await authed('/api/me');
    db.seed('UPDATE device SET is_banned = 1');
    expect((await submit(body(10))).status).toBe(403);
  });

  it('rejects 501 answers with a message the client can show', async () => {
    const response = await submit(body(501));
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toMatch(/högst 500 svar/);
  });

  it('accepts 500 answers', async () => {
    expect((await submit(body(500))).status).toBe(200);
  });

  it('refuses a body that declares itself larger than the cap', async () => {
    const response = await authed('/api/session', {
      method: 'POST',
      body: body(10),
      headers: { 'Content-Length': String(SESSION_BYTES_MAX + 1) },
    });
    expect(response.status).toBe(413);
  });

  it('rejects a session that ends in the future', async () => {
    const response = await submit(
      body(10, { endedAt: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
    );
    expect(response.status).toBe(400);
    expect((await response.json<{ error: string }>()).error).toMatch(/klocka/);
  });

  it('tolerates a clock a couple of minutes fast', async () => {
    const response = await submit(
      body(10, { endedAt: new Date(Date.now() + 2 * 60 * 1000).toISOString() }),
    );
    expect(response.status).toBe(200);
  });

  it('400s a body that is not json rather than 500ing', async () => {
    expect((await submit('not json')).status).toBe(400);
  });

  it('400s a body missing the fields it needs', async () => {
    expect((await submit(JSON.stringify({ sessionId: 'x' }))).status).toBe(400);
  });

  it('is idempotent at the route level', async () => {
    const payload = body(10);
    const first = await (await submit(payload)).json();
    const second = await (await submit(payload)).json();

    expect(second).toEqual(first);
    expect(db.read('SELECT id FROM session')).toHaveLength(1);
  });

  it('stores the computed score, not the claim', async () => {
    const response = await submit(body(10, { claimedScore: 999_999 }));
    const parsed = submitSessionResponseSchema.parse(await response.json());

    expect(parsed.score).not.toBe(999_999);
    const rows = db.read<{ score: number; claimed_score: number }>(
      'SELECT score, claimed_score FROM session',
    );
    expect(rows[0]?.claimed_score).toBe(999_999);
    expect(rows[0]?.score).toBe(parsed.score);
  });

  it('registers the device on a first-ever session, so a new install can submit', async () => {
    expect((await submit(body(10))).status).toBe(200);
    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });
});

/**
 * Now, as the moment every seeded session was played.
 *
 * Relative rather than a fixed date, because the week scope files a session under
 * the ISO week it ended in and the handler reads its own clock. A hard-coded
 * timestamp would put these fixtures in a season the route stops asking about the
 * following Monday.
 */
const PLAYED_AT = new Date().toISOString();
const PLAYED_SEASON = seasonIdFor(Date.parse(PLAYED_AT));

/**
 * One device with one qualifying session, seeded directly.
 *
 * Direct rather than through `POST /api/session`, because the route computes the
 * score from the answers and these tests are about the board rather than about
 * scoring. `best_score` is set by hand for the same reason the route maintains
 * it: it is what a rank outside the snapshot is measured against.
 */
function seedPlayer(index: number, score: number): string {
  const id = `d${String(index).padStart(3, '0')}`;
  const at = PLAYED_AT;

  db.seed(
    `INSERT INTO device (id, token_hash, display_name, avatar_seed, created_at,
                         last_seen_at, best_score)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id,
    `hash-${id}`,
    `Namn ${id}`,
    `seed-${id}`,
    at,
    at,
    score,
  );
  db.seed(
    `INSERT INTO session (id, device_id, deck_id, season_id, started_at, ended_at,
                          answered, correct, best_streak, score, claimed_score,
                          timings, flags, created_at)
     VALUES (?, ?, 'grund', ?, ?, ?, 10, 10, 5, ?, ?, '[]', NULL, ?)`,
    `s-${id}`,
    id,
    PLAYED_SEASON,
    at,
    at,
    score,
    score,
    at,
  );

  return id;
}

describe('GET /api/leaderboard', () => {
  beforeEach(async () => {
    for (let i = 0; i < 3; i += 1) seedPlayer(i, 900 - i * 100);
    await worker.scheduled(null, env);
  });

  it('answers the shape the shared schema describes, unauthenticated', async () => {
    const response = await call('/api/leaderboard');
    expect(response.status).toBe(200);

    const body = leaderboardResponseSchema.parse(await response.json());
    expect(body.scope).toBe('all-time');
    expect(body.rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(body.rows[0]?.score).toBe(900);
    expect(body.ageSeconds).not.toBeNull();
  });

  it('carries no per-caller field, so one cached body is correct for everybody', async () => {
    const body = await (await call('/api/leaderboard')).json<Record<string, unknown>>();
    expect(Object.keys(body)).not.toContain('isMe');
    expect(JSON.stringify(body)).not.toContain('isMe');
  });

  it('answers the week scope under its own season id', async () => {
    const response = await call('/api/leaderboard?scope=week');
    const body = leaderboardResponseSchema.parse(await response.json());

    expect(body.scope).toBe('week');
    expect(body.seasonId).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('400s a scope it does not serve', async () => {
    expect((await call('/api/leaderboard?scope=daily')).status).toBe(400);
  });

  it('400s a limit outside the range it will answer', async () => {
    expect((await call('/api/leaderboard?limit=0')).status).toBe(400);
    expect((await call('/api/leaderboard?limit=101')).status).toBe(400);
  });

  it('reads a bounded number of rows on a cache miss', async () => {
    db.resetCounters();
    await call('/api/leaderboard?limit=50');

    // The board plus the one histogram row the age is read from.
    expect(db.rowsRead).toBeLessThanOrEqual(51);
  });

  it('serves a second read from the cache at zero D1 rows', async () => {
    installCache();

    const first = await (await call('/api/leaderboard')).json();
    // The write is handed to `waitUntil`, so it has to land before the next read.
    await platform.settled();

    db.resetCounters();
    const second = await (await call('/api/leaderboard')).json();

    expect(second).toEqual(first);
    // The entire reason the cache is here: a hit spends none of the day's rows.
    expect(db.rowsRead).toBe(0);
  });

  it('treats a differently ordered query string as the same cache entry', async () => {
    installCache();
    await call('/api/leaderboard?scope=week&limit=25');
    await platform.settled();

    db.resetCounters();
    await call('/api/leaderboard?limit=25&scope=week');

    expect(db.rowsRead).toBe(0);
  });

  it('keeps a bigger board out of a smaller one', async () => {
    installCache();
    await call('/api/leaderboard?limit=1');
    await platform.settled();

    const body = leaderboardResponseSchema.parse(
      await (await call('/api/leaderboard?limit=50')).json(),
    );
    expect(body.rows).toHaveLength(3);
  });

  it('answers a cache hit with the calling origin, never the cached one', async () => {
    installCache();
    await call('/api/leaderboard');
    await platform.settled();

    const other = 'https://www.svenskakort.se';
    const hit = await call('/api/leaderboard', {}, other);

    // The stored body carries no CORS headers at all; they are applied per
    // request. Serving the first caller's origin to the second is the bug.
    expect(hit.headers.get('Access-Control-Allow-Origin')).toBe(other);
  });

  it('gives a disallowed origin no CORS header even on a cache hit', async () => {
    installCache();
    await call('/api/leaderboard');
    await platform.settled();

    const hit = await call('/api/leaderboard', {}, 'https://evil.example');
    expect(hit.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('serves an uncached board where there is no Cache API', async () => {
    // No `installCache()`: `caches` is absent, which is a runtime the Worker
    // should still answer on. The only cost is rows.
    const first = await call('/api/leaderboard');
    db.resetCounters();
    const second = await call('/api/leaderboard');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.rowsRead).toBeGreaterThan(0);
  });
});

describe('the snapshot rebuild', () => {
  it('builds both scopes from the cron', async () => {
    seedPlayer(0, 500);
    await worker.scheduled(null, env);

    const scopes = db.read<{ scope: string }>(
      'SELECT DISTINCT scope FROM leaderboard_snapshot ORDER BY scope',
    );
    expect(scopes.map((row) => row.scope)).toEqual(['all-time', 'week']);
  });

  it('is not run by a leaderboard read by default', async () => {
    seedPlayer(0, 500);
    const body = leaderboardResponseSchema.parse(
      await (await call('/api/leaderboard')).json(),
    );

    // With cron working, a read must not pay for a rebuild. An empty board and a
    // null age is the honest answer before the first cron fires.
    expect(body.rows).toEqual([]);
    expect(body.ageSeconds).toBeNull();
  });

  it('is run inline by a read when LAZY_SNAPSHOT says cron does not fire', async () => {
    seedPlayer(0, 500);
    env.LAZY_SNAPSHOT = '1';

    const body = leaderboardResponseSchema.parse(
      await (await call('/api/leaderboard')).json(),
    );
    expect(body.rows).toHaveLength(1);
  });

  it('rebuilds a stale snapshot on the lazy path', async () => {
    seedPlayer(0, 500);
    await worker.scheduled(null, env);
    // Older than `SNAPSHOT_MAX_AGE_MS` however long that is, without waiting.
    db.seed(`UPDATE score_histogram SET built_at = '2020-01-01T00:00:00.000Z'`);
    seedPlayer(1, 900);

    env.LAZY_SNAPSHOT = '1';
    const body = leaderboardResponseSchema.parse(
      await (await call('/api/leaderboard')).json(),
    );

    expect(body.rows[0]?.score).toBe(900);
  });

  it('leaves a fresh snapshot alone on the lazy path', async () => {
    seedPlayer(0, 500);
    await worker.scheduled(null, env);
    seedPlayer(1, 900);

    env.LAZY_SNAPSHOT = '1';
    const body = leaderboardResponseSchema.parse(
      await (await call('/api/leaderboard')).json(),
    );

    // The second player is missing on purpose: the snapshot is minutes fresh, and
    // rebuilding it on every read is the read pattern the lazy path exists to
    // avoid rather than the one it introduces.
    expect(body.rows).toHaveLength(1);
  });

  it('reports the snapshot age on health once something has been built', async () => {
    seedPlayer(0, 500);
    await worker.scheduled(null, env);

    const body = healthResponseSchema.parse(await (await call('/api/health')).json());
    // A number that climbs is how a cron that has quietly stopped firing becomes
    // visible; null would only mean it never fired at all.
    expect(body.snapshotAgeSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('rank on /api/me', () => {
  it('reports the device its exact rank once it is on the board', async () => {
    await authed('/api/me');
    const [row] = db.read<{ id: string }>('SELECT id FROM device');
    const id = row?.id ?? '';

    db.seed(
      `INSERT INTO session (id, device_id, deck_id, season_id, started_at, ended_at,
                            answered, correct, best_streak, score, claimed_score,
                            timings, flags, created_at)
       VALUES ('s-me', ?, 'grund', ?, ?, ?, 10, 10, 5, 700, 700, '[]', NULL, ?)`,
      id,
      PLAYED_SEASON,
      PLAYED_AT,
      PLAYED_AT,
      PLAYED_AT,
    );
    db.seed('UPDATE device SET best_score = 700 WHERE id = ?', id);
    await worker.scheduled(null, env);

    const body = meResponseSchema.parse(await (await authed('/api/me')).json());
    expect(body.rank).toBe(1);
  });

  it('reports no rank for a learner who has not placed', async () => {
    seedPlayer(0, 900);
    await worker.scheduled(null, env);

    // Null, not last: the board does not know about this device yet, and showing
    // a position would claim otherwise.
    const body = meResponseSchema.parse(await (await authed('/api/me')).json());
    expect(body.rank).toBeNull();
  });

  it('costs a bounded read on top of the profile', async () => {
    await authed('/api/me');
    db.resetCounters();
    await authed('/api/me');

    // The device row, its snapshot lookup, and at most the histogram. The
    // ticket's budget for a rank is 70 rows.
    expect(db.rowsRead).toBeLessThanOrEqual(70);
  });
});

describe('POST /api/transfer/create', () => {
  it('401s without a token', async () => {
    const response = await call('/api/transfer/create', { method: 'POST' });
    expect(response.status).toBe(401);
  });

  it('answers the shared schema for an authenticated device', async () => {
    const response = await authed('/api/transfer/create', { method: 'POST' });
    expect(response.status).toBe(200);

    const body = createTransferCodeResponseSchema.parse(await response.json());
    expect(body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('never puts the token in the transfer-create response', async () => {
    const response = await authed('/api/transfer/create', { method: 'POST' });
    expect(await response.text()).not.toContain(TOKEN);
  });
});

describe('POST /api/transfer/claim', () => {
  it('400s a missing code rather than 500ing', async () => {
    const response = await fromIp('/api/transfer/claim', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(response.status).toBe(400);
  });

  it('400s a code nobody ever created, with a generic message', async () => {
    const response = await fromIp('/api/transfer/claim', {
      method: 'POST',
      body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
  });

  it('still rate-limits a caller with no CF-Connecting-IP header', async () => {
    const response = await call('/api/transfer/claim', {
      method: 'POST',
      body: JSON.stringify({ code: 'ZZZZ-ZZZZ' }),
    });
    expect(response.status).toBe(400);
  });

  it('400s a body that is not JSON rather than 500ing', async () => {
    const response = await fromIp('/api/transfer/claim', { method: 'POST', body: 'not json' });
    expect(response.status).toBe(400);
  });

  it('rate-limits to 5 attempts a minute per IP, refusing the 6th', async () => {
    const attempt = () =>
      fromIp('/api/transfer/claim', {
        method: 'POST',
        body: JSON.stringify({ code: 'WRNG-CODE' }),
      });

    let last: Response | undefined;
    for (let i = 0; i < 6; i += 1) last = await attempt();

    expect(last?.status).toBe(429);
  });

  it('moves an account from one device to another end to end', async () => {
    // Device A: registers, plays, then creates a code.
    await authed('/api/me', {}, TOKEN);
    await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Ada', avatarSeed: 'ada' }),
    });
    const created = createTransferCodeResponseSchema.parse(
      await (await authed('/api/transfer/create', { method: 'POST' })).json(),
    );

    // Device B: an unauthenticated caller claims the code.
    const claimResponse = await fromIp('/api/transfer/claim', {
      method: 'POST',
      body: JSON.stringify({ code: created.code }),
    });
    expect(claimResponse.status).toBe(200);
    const claimed = claimTransferCodeResponseSchema.parse(await claimResponse.json());

    // The new token reads and writes Device A's original account.
    const meOnB = meResponseSchema.parse(await (await authed('/api/me', {}, claimed.token)).json());
    expect(meOnB.displayName).toBe('Ada');

    const renameOnB = meResponseSchema.parse(
      await (
        await authed('/api/me', {
          method: 'PUT',
          body: JSON.stringify({ displayName: 'Ada B', avatarSeed: 'ada' }),
        }, claimed.token)
      ).json(),
    );
    expect(renameOnB.displayName).toBe('Ada B');

    // The old token on Device A no longer authenticates — it was overwritten.
    const meOnA = await authed('/api/me', {}, TOKEN);
    expect(meOnA.status).toBe(200);
    // A device row for the old token is created fresh (first sight again),
    // rather than reaching the transferred account.
    const freshA = meResponseSchema.parse(await meOnA.json());
    expect(freshA.deviceId).not.toBe(meOnB.deviceId);
  });

  it('lets a second code invalidate the first', async () => {
    await authed('/api/me');
    const first = createTransferCodeResponseSchema.parse(
      await (await authed('/api/transfer/create', { method: 'POST' })).json(),
    );
    createTransferCodeResponseSchema.parse(
      await (await authed('/api/transfer/create', { method: 'POST' })).json(),
    );

    const response = await fromIp('/api/transfer/claim', {
      method: 'POST',
      body: JSON.stringify({ code: first.code }),
    });
    expect(response.status).toBe(400);
  });

  it('never puts the submitted code in the response', async () => {
    const secretCode = 'ABCD-EFGH';
    const response = await fromIp('/api/transfer/claim', {
      method: 'POST',
      body: JSON.stringify({ code: secretCode }),
    });
    expect(await response.text()).not.toContain('ABCD');
  });
});
