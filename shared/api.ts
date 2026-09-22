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

/**
 * The message to show a learner for a failed parse.
 *
 * Validation failures on a learner's own input are the one place a specific
 * message is right — "something went wrong" leaves them unable to fix a name
 * that is one character too long. The fallback covers an error carrying no
 * issues, which zod does not produce but which is cheaper to handle than to
 * prove impossible.
 */
export function firstIssue(error: z.ZodError): string {
  for (const issue of error.issues) return issue.message;
  return 'Något i formuläret gick inte att läsa.';
}

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

// --- GET /api/me ------------------------------------------------------------

/**
 * The caller's own account. Doubles as registration: the first authenticated
 * call with an unseen token creates the row, so there is no signup endpoint to
 * forget to call.
 *
 * `rank` is null until P05 computes one, and stays null for a learner who has
 * not placed. It is deliberately not a number-or-zero: zero is a rank.
 */
export interface MeResponse {
  deviceId: string;
  displayName: string;
  avatarSeed: string;
  isAdmin: boolean;
  createdAt: string;
  totalScore: number;
  bestStreak: number;
  rank: number | null;
}

export const meResponseSchema = z.object({
  deviceId: z.string(),
  displayName: z.string(),
  avatarSeed: z.string(),
  isAdmin: z.boolean(),
  createdAt: z.string(),
  totalScore: z.number(),
  bestStreak: z.number(),
  rank: z.number().nullable(),
});

/** Sent with the first call so a new device can name itself as it registers. */
export const registrationSchema = z.object({
  displayName: displayNameSchema,
  avatarSeed: z.string().min(1).max(40),
});

export type Registration = z.infer<typeof registrationSchema>;

// --- PUT /api/me ------------------------------------------------------------

export const updateProfileSchema = z.object({
  displayName: displayNameSchema,
  avatarSeed: z.string().min(1).max(40),
});

export type UpdateProfileRequest = z.infer<typeof updateProfileSchema>;
