import { z } from 'zod';
import { DISPLAY_NAME_MAX, DISPLAY_NAME_MIN, FORBIDDEN_TEXT } from './constants';

/**
 * The wire contract. The app and the Worker both import this file and neither
 * declares its own copy of a payload — a contract that exists twice drifts.
 *
 * Entries are alphabetical. Each endpoint brings its request schema, its
 * response type, and nothing else; handlers live in `worker/src/`.
 *
 * Only the routes that exist are described here. The rest of phase 3 adds its
 * own as it builds them, so a schema is never written before the handler that
 * has to satisfy it.
 */

/** Every error body on every route: one shape, no detail that confirms existence. */
export interface ApiError {
  error: string;
}

export const apiErrorSchema = z.object({
  error: z.string(),
});

// --- display name -----------------------------------------------------------

/**
 * Shown publicly, typed by hand, and the one piece of free text that exists
 * before any endpoint does. Collapsing whitespace before measuring is what
 * makes the client and server agree on the length of `"a     b"`.
 */
export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export const displayNameSchema = z
  .string()
  .transform(normalizeDisplayName)
  .refine((name) => name.length >= DISPLAY_NAME_MIN, {
    message: `Namnet måste vara minst ${DISPLAY_NAME_MIN} tecken.`,
  })
  .refine((name) => name.length <= DISPLAY_NAME_MAX, {
    message: `Namnet får vara högst ${DISPLAY_NAME_MAX} tecken.`,
  })
  .refine((name) => !FORBIDDEN_TEXT.test(name), {
    message: 'Namnet innehåller tecken som inte är tillåtna.',
  })
  // A name of pure punctuation renders as a blank row on the leaderboard.
  .refine((name) => /[\p{L}\p{N}]/u.test(name), {
    message: 'Namnet måste innehålla en bokstav eller en siffra.',
  });

// --- GET /api/health --------------------------------------------------------

export interface HealthResponse {
  ok: true;
  /** The deployed commit, so a stale Worker is visible rather than guessed at. */
  version: string;
}

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
});
