/**
 * One call, one parse. Every route in `shared/api.ts` brings its own response
 * schema, so a caller never trusts a shape it has not validated — a Worker
 * redeploy that changes a field is a caught mismatch here, not a crash in a
 * component three layers up.
 *
 * `status` is kept on failure because that is the one thing every caller
 * needs and none of them agrees on how to use: the outbox drops a session on
 * a 4xx and retries a 5xx or a network error (`status: null`); a route just
 * wants to know whether to show an error state.
 */
import type { z } from 'zod';
import { apiErrorSchema } from '../../shared/api';
import { apiUrl } from './apiBase';
import { authHeader } from './deviceToken';

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

interface ApiRequestOptions {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  body?: unknown;
  /** False only for the leaderboard read, which is deliberately unauthenticated. */
  auth?: boolean;
}

export async function apiRequest<T>(
  schema: z.ZodType<T>,
  { method, path, body, auth = true }: ApiRequestOptions,
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  if (auth) {
    const header = authHeader();
    // No token means no account yet. The caller decides what that means —
    // this file only speaks HTTP, never the device-token lifecycle.
    if (header === null) return { ok: false, status: null, message: 'No device token.' };
    Object.assign(headers, header);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // Offline, DNS failure, CORS refusal — none of it is a status code, and
    // `status: null` is what tells a retrier this is worth trying again.
    return { ok: false, status: null, message: error instanceof Error ? error.message : 'Network error.' };
  }

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = undefined;
  }

  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(parsedBody);
    return {
      ok: false,
      status: response.status,
      message: parsedError.success ? parsedError.data.error : `HTTP ${String(response.status)}`,
    };
  }

  const parsed = schema.safeParse(parsedBody);
  if (!parsed.success) {
    // A 2xx that fails to parse is a Worker the client has fallen out of sync
    // with, not something a retry fixes — same bucket as any other 2xx.
    return { ok: false, status: response.status, message: 'Unexpected response shape.' };
  }

  return { ok: true, data: parsed.data };
}
