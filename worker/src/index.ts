import type {
  ClaimTransferCodeResponse,
  CreateTransferCodeResponse,
  HealthResponse,
  LeaderboardResponse,
  MeResponse,
  Registration,
} from '../../shared/api';
import {
  claimTransferCodeSchema,
  firstIssue,
  leaderboardQuerySchema,
  registrationSchema,
  submitSessionSchema,
  updateProfileSchema,
} from '../../shared/api';
import { SESSION_BYTES_MAX } from '../../shared/constants';
import { AuthError, requireDevice, sha256Hex, type Device } from './auth';
import { awardTopTen, badgesFor } from './badges';
import { cachedResponse, cacheResponse, LEADERBOARD_MAX_AGE_SECONDS, leaderboardCacheKey } from './cache';
import { corsHeaders, preflight } from './cors';
import {
  rankFor,
  rebuildAll,
  rebuildScope,
  seasonForScope,
  snapshotAgeSeconds,
  SNAPSHOT_MAX_AGE_MS,
  topRows,
} from './leaderboard';
import { lookup, type Ctx, type Route } from './router';
import { FUTURE_TOLERANCE_MS, submitSession } from './session';
import { claimCode, createCode } from './transfer';

export interface Env {
  /** Set by wrangler from the deployed commit; `dev` when running locally. */
  VERSION: string;
  DB: D1Database;
  /**
   * `"1"` turns on rebuilding the snapshot inline when a leaderboard read finds
   * it stale, for a platform where cron triggers are unavailable.
   *
   * A var rather than a code path chosen at build time, so discovering that cron
   * does not fire on this plan is a `wrangler.toml` edit and a redeploy, not a
   * rewrite. Off by default: with cron working, this only adds tail latency to
   * whichever unlucky request notices the staleness first.
   */
  LAZY_SNAPSHOT?: string;
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  });
}

/**
 * Every failure says the same thing. A message that varies with the cause is a
 * message that confirms what exists, and existence is the thing worth hiding.
 */
function fail(request: Request, status: number, error: string): Response {
  return json(request, { error }, status);
}

async function meBody(device: Device, rank: number | null, env: Env): Promise<MeResponse> {
  return {
    deviceId: device.id,
    displayName: device.display_name,
    avatarSeed: device.avatar_seed,
    isAdmin: device.is_admin === 1,
    createdAt: device.created_at,
    totalScore: device.total_score,
    bestStreak: device.best_streak,
    rank,
    badges: await badgesFor(device.id, env.DB),
  };
}

/**
 * The device's all-time rank.
 *
 * All-time rather than the current week because `MeResponse.rank` is one number
 * and lifetime standing is the one a learner means by "my rank". `best_score` is
 * the maintained counter, so this is two indexed reads and no aggregate.
 */
function myRank(device: Device, env: Env): Promise<number | null> {
  return rankFor(device.id, device.best_score, 'all-time', { db: env.DB, now: Date.now() });
}

/**
 * The registration hint on a first call, if the body carries one.
 *
 * A malformed or absent body is not an error: registration must succeed for a
 * learner who has never opened the profile form, and `requireDevice` falls back
 * to the same defaults the app already displays.
 */
async function registrationHint(request: Request): Promise<Registration | undefined> {
  try {
    const parsed = registrationSchema.safeParse(await request.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Refuses an oversized body before anything parses it.
 *
 * `Content-Length` is the client's claim, but it is the claim that decides
 * whether the Worker spends CPU on `JSON.parse`, and a 500-answer session is
 * ~15 KB against a 64 KB cap. A body that lies about its length still hits the
 * answer-count cap in the schema.
 */
function tooLarge(request: Request, max: number): boolean {
  const declared = Number(request.headers.get('Content-Length') ?? '0');
  return Number.isFinite(declared) && declared > max;
}

const routes: readonly Route<Env>[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: async (request, env) => {
      const body: HealthResponse = {
        ok: true,
        version: env.VERSION,
        // One indexed row. A cron that has quietly stopped firing shows up here
        // as a number that keeps climbing, which is otherwise invisible until
        // someone notices the board has not moved all day.
        snapshotAgeSeconds: await snapshotAgeSeconds('all-time', {
          db: env.DB,
          now: Date.now(),
        }),
      };
      return json(request, body);
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handler: async (request, env) => {
      const device = await requireDevice(request, deps(env));
      return json(request, await meBody(device, await myRank(device, env), env));
    },
  },
  {
    method: 'POST',
    path: '/api/me',
    handler: async (request, env) => {
      // First sight registers. The body names the device if it can be read; a
      // client that sends nothing still gets an account.
      const hint = await registrationHint(request);
      const device = await requireDevice(request, deps(env), hint);
      return json(request, await meBody(device, await myRank(device, env), env));
    },
  },
  {
    method: 'PUT',
    path: '/api/me',
    handler: async (request, env) => {
      const parsed = updateProfileSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return fail(request, 400, firstIssue(parsed.error));

      const device = await requireDevice(request, deps(env), parsed.data);
      await env.DB.prepare('UPDATE device SET display_name = ?, avatar_seed = ? WHERE id = ?')
        .bind(parsed.data.displayName, parsed.data.avatarSeed, device.id)
        .run();

      return json(request, {
        ...(await meBody(device, await myRank(device, env), env)),
        displayName: parsed.data.displayName,
        avatarSeed: parsed.data.avatarSeed,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/leaderboard',
    handler: (request, env, _params, ctx) => leaderboard(request, env, ctx),
  },
  {
    method: 'POST',
    path: '/api/session',
    handler: async (request, env) => {
      // Auth before the body. A junk token is refused without a D1 read and
      // without a byte of JSON parsed, which is the order that makes an
      // anonymous flood cheap to absorb.
      const device = await requireDevice(request, deps(env));

      if (tooLarge(request, SESSION_BYTES_MAX)) {
        return fail(request, 413, 'Sessionen är för stor.');
      }

      const parsed = submitSessionSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return fail(request, 400, firstIssue(parsed.error));

      // The one clock check that rejects rather than flags. A session ending in
      // the future would be filed into a season that has not started, which no
      // later snapshot would ever pick up — so it has to be refused at the door
      // rather than stored where nothing would read it.
      const now = Date.now();
      if (Date.parse(parsed.data.endedAt) > now + FUTURE_TOLERANCE_MS) {
        return fail(request, 400, 'Sessionen slutar i framtiden. Kontrollera enhetens klocka.');
      }

      return json(request, await submitSession(parsed.data, device, { db: env.DB, now }));
    },
  },
  {
    method: 'POST',
    path: '/api/transfer/create',
    handler: async (request, env) => {
      const device = await requireDevice(request, deps(env));
      const created = await createCode(device, deps(env));
      const body: CreateTransferCodeResponse = created;
      return json(request, body);
    },
  },
  {
    method: 'POST',
    path: '/api/transfer/claim',
    handler: async (request, env) => {
      const parsed = claimTransferCodeSchema.safeParse(await request.json().catch(() => null));
      if (!parsed.success) return fail(request, 400, firstIssue(parsed.error));

      // Hashed before it ever reaches a query or a log line, same as the
      // device token: the limiter needs to recognize a caller again, not
      // retain an address that identifies them.
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const ipHash = await sha256Hex(ip);

      const outcome = await claimCode(parsed.data.code, ipHash, deps(env));
      if (!outcome.ok) return fail(request, outcome.status, outcome.error);

      const body: ClaimTransferCodeResponse = { token: outcome.token };
      return json(request, body);
    },
  },
];

/**
 * The board.
 *
 * Unauthenticated on purpose. The response is identical for every caller — `isMe`
 * is the client's business — and that is exactly what lets one cached body serve
 * everybody, which is what makes a hit cost zero D1 rows. Requiring a token here
 * would buy nothing and would make the cache per-device.
 */
async function leaderboard(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const parsed = leaderboardQuerySchema.safeParse({
    scope: url.searchParams.get('scope') ?? 'all-time',
    limit: url.searchParams.get('limit') ?? '50',
  });
  if (!parsed.success) return fail(request, 400, firstIssue(parsed.error));

  const { scope, limit } = parsed.data;
  const now = Date.now();
  const seasonId = seasonForScope(scope, now);
  const key = leaderboardCacheKey(scope, seasonId, limit);

  const hit = await cachedResponse(key);
  // Not `hit.headers` reused wholesale: the cached entry carries no CORS headers
  // by design, so they are added here against *this* request's origin.
  if (hit !== null) return withCors(request, hit);

  const lbDeps = { db: env.DB, now };

  // The fallback for a platform where cron triggers do not fire. Off unless
  // `LAZY_SNAPSHOT` says otherwise, because with cron working this only makes one
  // unlucky request pay for the rebuild.
  if (env.LAZY_SNAPSHOT === '1') {
    const age = await snapshotAgeSeconds(scope, lbDeps);
    if (age === null || age * 1000 > SNAPSHOT_MAX_AGE_MS) await rebuildScope(scope, lbDeps);
  }

  const body: LeaderboardResponse = {
    scope,
    seasonId,
    rows: await topRows(scope, limit, lbDeps),
    ageSeconds: await snapshotAgeSeconds(scope, lbDeps),
  };

  const cacheable = new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${LEADERBOARD_MAX_AGE_SECONDS}`,
    },
  });

  // `clone()` because a Response body is a stream and can only be read once: the
  // cache gets one copy and the learner gets the other.
  ctx.waitUntil(cacheResponse(key, cacheable.clone()));
  return withCors(request, cacheable);
}

/** The same body and status, with this request's CORS headers on it. */
function withCors(request: Request, response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders(request))) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

function deps(env: Env) {
  return { db: env.DB, now: Date.now(), uuid: () => crypto.randomUUID() };
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request);

    const { matched, methodMismatch } = lookup(routes, request);
    if (matched === null) {
      return fail(request, methodMismatch ? 405 : 404, 'Not found');
    }

    try {
      return await matched.handler(request, env, matched.params, ctx);
    } catch (error) {
      // A refused credential is an expected outcome, not a failure, so it keeps
      // its status. Everything else collapses to 500 with nothing from the
      // error: a stack or a D1 message in a response body is how a token or a
      // schema leaks.
      if (error instanceof AuthError) return fail(request, error.status, error.body);
      return fail(request, 500, 'Something went wrong');
    }
  },

  /**
   * The snapshot rebuild, every ten minutes per `wrangler.toml`.
   *
   * Errors are deliberately not caught. A cron that fails silently is a
   * leaderboard that quietly stops moving; letting it throw puts it in the
   * Worker's error log, and `/api/health` reports the climbing snapshot age
   * either way.
   */
  async scheduled(_event: unknown, env: Env): Promise<void> {
    const now = Date.now();
    await rebuildAll({ db: env.DB, now });
    // Reads the snapshot `rebuildAll` just wrote, so the previous week's
    // standings it checks are always current as of this tick.
    await awardTopTen({ db: env.DB, now });
  },
};
