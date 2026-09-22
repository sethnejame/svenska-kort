import type { HealthResponse } from '../../shared/api';
import { corsHeaders, preflight } from './cors';
import { lookup, type Route } from './router';

export interface Env {
  /** Set by wrangler from the deployed commit; `dev` when running locally. */
  VERSION: string;
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

const routes: readonly Route<Env>[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: (request, env) => {
      const body: HealthResponse = { ok: true, version: env.VERSION };
      return json(request, body);
    },
  },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return preflight(request);

    const { matched, methodMismatch } = lookup(routes, request);
    if (matched === null) {
      return fail(request, methodMismatch ? 405 : 404, 'Not found');
    }

    try {
      return await matched.handler(request, env, matched.params);
    } catch {
      // Deliberately nothing from the error: a stack or a D1 message in a
      // response body is how a token or a schema leaks.
      return fail(request, 500, 'Something went wrong');
    }
  },
};
