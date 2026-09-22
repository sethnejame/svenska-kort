import type { HealthResponse, MeResponse, Registration } from '../../shared/api';
import {
  firstIssue,
  registrationSchema,
  submitSessionSchema,
  updateProfileSchema,
} from '../../shared/api';
import { SESSION_BYTES_MAX } from '../../shared/constants';
import { AuthError, requireDevice, type Device } from './auth';
import { corsHeaders, preflight } from './cors';
import { lookup, type Route } from './router';
import { FUTURE_TOLERANCE_MS, submitSession } from './session';

export interface Env {
  /** Set by wrangler from the deployed commit; `dev` when running locally. */
  VERSION: string;
  DB: D1Database;
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

function meBody(device: Device): MeResponse {
  return {
    deviceId: device.id,
    displayName: device.display_name,
    avatarSeed: device.avatar_seed,
    isAdmin: device.is_admin === 1,
    createdAt: device.created_at,
    totalScore: device.total_score,
    bestStreak: device.best_streak,
    // P05 fills this from the histogram. Null until then, and null forever for a
    // learner who has not placed.
    rank: null,
  };
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
    handler: (request, env) => {
      const body: HealthResponse = { ok: true, version: env.VERSION };
      return json(request, body);
    },
  },
  {
    method: 'GET',
    path: '/api/me',
    handler: async (request, env) => {
      const device = await requireDevice(request, deps(env));
      return json(request, meBody(device));
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
      return json(request, meBody(device));
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
        ...meBody(device),
        displayName: parsed.data.displayName,
        avatarSeed: parsed.data.avatarSeed,
      });
    },
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
];

function deps(env: Env) {
  return { db: env.DB, now: Date.now(), uuid: () => crypto.randomUUID() };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request);

    const { matched, methodMismatch } = lookup(routes, request);
    if (matched === null) {
      return fail(request, methodMismatch ? 405 : 404, 'Not found');
    }

    try {
      return await matched.handler(request, env, matched.params);
    } catch (error) {
      // A refused credential is an expected outcome, not a failure, so it keeps
      // its status. Everything else collapses to 500 with nothing from the
      // error: a stack or a D1 message in a response body is how a token or a
      // schema leaks.
      if (error instanceof AuthError) return fail(request, error.status, error.body);
      return fail(request, 500, 'Something went wrong');
    }
  },
};
