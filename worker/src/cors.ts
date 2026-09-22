/**
 * The bearer token is a credential, so the allowlist is exact origins and never
 * `*`. A browser that sends `Authorization` to an origin we did not name is a
 * browser handing the learner's account to whoever asked.
 */
const ALLOWED_ORIGINS: readonly string[] = [
  'https://svenskakort.se',
  'https://www.svenskakort.se',
  // `vite dev` and `vite preview`, so local work does not need a CORS exception
  // in the handler. Neither can be reached from anyone else's machine.
  'http://localhost:5173',
  'http://localhost:4173',
];

const ALLOWED_METHODS = 'GET, POST, OPTIONS';
const ALLOWED_HEADERS = 'Authorization, Content-Type';
/** A day: the preflight is pure overhead and the allowlist changes on deploy. */
const MAX_AGE_SECONDS = 86400;

export function allowedOrigin(request: Request): string | null {
  const origin = request.headers.get('Origin');
  if (origin === null) return null;
  return ALLOWED_ORIGINS.includes(origin) ? origin : null;
}

/**
 * Returns the headers to merge into a response, or an empty object when the
 * origin is not allowed — omitting the header is what makes the browser refuse
 * it. Note there is no `Access-Control-Allow-Credentials`: the token travels in
 * `Authorization`, not a cookie, so the app never needs it.
 */
export function corsHeaders(request: Request): Record<string, string> {
  const origin = allowedOrigin(request);
  if (origin === null) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    // The allowlist has more than one entry, so a cache keyed only on the URL
    // would hand one origin's response to another.
    Vary: 'Origin',
  };
}

/** The preflight. A disallowed origin gets 403 and no allow headers. */
export function preflight(request: Request): Response {
  const origin = allowedOrigin(request);
  if (origin === null) return new Response(null, { status: 403 });

  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(request),
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Max-Age': String(MAX_AGE_SECONDS),
    },
  });
}
