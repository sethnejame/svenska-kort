/**
 * The edge cache in front of the leaderboard.
 *
 * A cached hit costs zero D1 rows, which is the entire point: at sixty seconds
 * the board is fresh enough for a vocabulary app — the snapshot behind it is
 * rebuilt every thirty minutes anyway, so a shorter TTL would buy nothing — and
 * the read budget stops mattering.
 *
 * Two things are deliberately not cached with the body:
 *
 * - **CORS headers.** They vary with the request's `Origin`, and one origin's
 *   headers served to another is either a broken client or a hole. The cache
 *   stores the body; `corsHeaders` is applied to every response on the way out,
 *   hit or miss.
 * - **Anything per-caller.** `isMe` is computed by the client from `deviceId`
 *   precisely so that one cached body is correct for everybody.
 */

/** Sixty seconds, as both the header and the edge's own TTL. */
export const LEADERBOARD_MAX_AGE_SECONDS = 60;

/**
 * The canonical key for a board.
 *
 * Built from the parsed and clamped values rather than from `request.url`, so
 * `?limit=50&scope=week` and `?scope=week&limit=50` are one cache entry instead
 * of two. The hostname is a placeholder that never resolves: a cache key is a
 * key, not an address.
 */
export function leaderboardCacheKey(scope: string, seasonId: string, limit: number): string {
  // `seasonId` is in the key, so a week rollover cannot serve last week's board:
  // the new season asks a question the cache has never been asked.
  return `https://cache.svenskakort.invalid/leaderboard/${encodeURIComponent(
    scope,
  )}/${encodeURIComponent(seasonId === '' ? 'all' : seasonId)}/${limit}`;
}

/**
 * `caches.default`, or null where there is no Cache API.
 *
 * Null rather than a thrown error or a Map: a runtime without the Cache API
 * should serve an uncached board, not fail. The only cost is D1 rows.
 */
function edge(): Cache | null {
  // `caches` is a Workers global. Feature-detected rather than assumed so this
  // module can be exercised — and the Worker can run — anywhere.
  const api = (globalThis as { caches?: { default?: Cache } }).caches;
  return api?.default ?? null;
}

/** A previously cached body, or null. */
export async function cachedResponse(key: string): Promise<Response | null> {
  const cache = edge();
  if (cache === null) return null;

  const hit = await cache.match(new Request(key));
  return hit ?? null;
}

/**
 * Stores a body against the key.
 *
 * Handed to `waitUntil` by the caller rather than awaited: the learner should not
 * wait on a cache write to see the board they already have.
 */
export async function cacheResponse(key: string, response: Response): Promise<void> {
  const cache = edge();
  if (cache === null) return;

  await cache.put(new Request(key), response);
}
