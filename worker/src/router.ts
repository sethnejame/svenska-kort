/**
 * The whole router. The API is nine routes at its largest, which is a `find`
 * over an array — a framework here would cost a dependency and bundle size to
 * replace ten lines.
 *
 * Paths are matched literally or with a single `:param` segment. There is no
 * wildcard, no nesting and no middleware stack, because nothing in this API
 * needs one.
 */
/**
 * What a handler gets of the platform beyond its bindings.
 *
 * Only `waitUntil`, because that is the only part any handler needs: the
 * leaderboard writes to the edge cache after responding, and a learner should not
 * wait on a cache write to see a board they already have. Narrowed to this rather
 * than passing Cloudflare's `ExecutionContext` through, so a test supplies two
 * lines instead of a platform object.
 */
export interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
}

export type Handler<Env> = (
  request: Request,
  env: Env,
  params: Readonly<Record<string, string>>,
  ctx: Ctx,
) => Response | Promise<Response>;

export interface Route<Env> {
  method: string;
  /** e.g. `/api/decks/shared/:id` */
  path: string;
  handler: Handler<Env>;
}

interface Matched<Env> {
  handler: Handler<Env>;
  params: Record<string, string>;
}

function segments(path: string): string[] {
  return path.split('/').filter((part) => part.length > 0);
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const expected = segments(pattern);
  const actual = segments(pathname);

  const params: Record<string, string> = {};
  for (const [index, part] of expected.entries()) {
    // Running off the end of the path is a short URL, not an internal error:
    // `/api/decks/shared` against `/api/decks/shared/:id`.
    const value = actual[index];
    if (value === undefined) return null;

    if (part.startsWith(':')) {
      params[part.slice(1)] = decodeURIComponent(value);
      continue;
    }
    if (part !== value) return null;
  }

  // A `:param` matches one segment, never the rest of the path.
  if (actual.length > expected.length) return null;

  return params;
}

export interface Lookup<Env> {
  /** Null when no route has this path at all — a 404 rather than a 405. */
  matched: Matched<Env> | null;
  /** True when the path exists under a different method. */
  methodMismatch: boolean;
}

export function lookup<Env>(routes: readonly Route<Env>[], request: Request): Lookup<Env> {
  const { pathname } = new URL(request.url);
  let methodMismatch = false;

  for (const route of routes) {
    const params = matchPath(route.path, pathname);
    if (params === null) continue;
    if (route.method !== request.method) {
      methodMismatch = true;
      continue;
    }
    return { matched: { handler: route.handler, params }, methodMismatch: false };
  }

  return { matched: null, methodMismatch };
}
