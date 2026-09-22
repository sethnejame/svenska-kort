import { z } from 'zod';
import {
  DAY_MS,
  DISPLAY_NAME_MAX,
  DISPLAY_NAME_MIN,
  FORBIDDEN_TEXT,
  SESSION_ANSWERS_MAX,
} from './constants';

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

// --- scopes -----------------------------------------------------------------

/**
 * Which board is being asked for.
 *
 * `week` is the current ISO week and `all-time` spans every season. A weekly
 * reset is a new `season_id`, never a delete, so a botched season boundary is a
 * display bug rather than lost history.
 */
export const scopeSchema = z.enum(['all-time', 'week']);

export type Scope = z.infer<typeof scopeSchema>;

// --- GET /api/health --------------------------------------------------------

export interface HealthResponse {
  ok: true;
  /** The deployed commit, so a stale Worker is visible rather than guessed at. */
  version: string;
  /**
   * Age of the all-time snapshot, or null if it has never been built.
   *
   * Here for P14: a cron that has quietly stopped shows up as a number that
   * keeps climbing, which is otherwise invisible until someone notices the
   * leaderboard has not moved in a day.
   */
  snapshotAgeSeconds: number | null;
}

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  version: z.string(),
  snapshotAgeSeconds: z.number().nullable(),
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

// --- POST /api/session ------------------------------------------------------

/** An id the client generated: a session uuid, a deck id, an entry slug. */
const clientId = z.string().min(1).max(80);

export const verdictSchema = z.enum(['correct', 'close', 'wrong']);

/**
 * One answer, as reported.
 *
 * `elapsedMs` is deliberately allowed to be negative and to be absurdly small.
 * Both are nonsense, and rejecting them here would mean the `impossible-timing`
 * flag could never fire — a tampered payload would 400 instead of being stored
 * and quietly held off the leaderboard, which is the outcome worth having. The
 * bounds that *are* enforced only stop a number large enough to break the
 * arithmetic downstream.
 */
export const sessionAnswerSchema = z.object({
  entryId: clientId,
  verdict: verdictSchema,
  elapsedMs: z.number().int().gte(-DAY_MS).lte(DAY_MS),
  wasTyped: z.boolean(),
  acceptedOnRetry: z.boolean(),
});

export const submitSessionSchema = z.object({
  /** The idempotency key. The outbox retries blindly, and this is what makes that safe. */
  sessionId: clientId,
  deckId: clientId,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  answers: z.array(sessionAnswerSchema).max(SESSION_ANSWERS_MAX, {
    message: `En session kan innehålla högst ${SESSION_ANSWERS_MAX} svar.`,
  }),
  /** Recorded for audit and compared against the recomputed score. Never stored as the score. */
  claimedScore: z.number().int().gte(0).lte(10_000_000),
  claimedBestStreak: z.number().int().gte(0).lte(SESSION_ANSWERS_MAX),
});

export type SubmitSessionRequest = z.infer<typeof submitSessionSchema>;

/**
 * What the learner gets back: the server's arithmetic, and nothing about flags.
 *
 * A flagged session returns exactly this, with exactly these numbers. The
 * learner is never told, because the checks have false positives and the honest
 * fast learner must not be shown an accusation.
 */
export interface SubmitSessionResponse {
  sessionId: string;
  /** Server-computed. Differs from `claimedScore` whenever the client was wrong or lying. */
  score: number;
  answered: number;
  correct: number;
  bestStreak: number;
  /** The device's running total after this session. */
  totalScore: number;
  rank: number | null;
}

export const submitSessionResponseSchema = z.object({
  sessionId: z.string(),
  score: z.number(),
  answered: z.number(),
  correct: z.number(),
  bestStreak: z.number(),
  totalScore: z.number(),
  rank: z.number().nullable(),
});

// --- GET /api/leaderboard ---------------------------------------------------

export const leaderboardQuerySchema = z.object({
  scope: scopeSchema,
  /** Clamped server-side to the snapshot size; a larger number is not an error. */
  limit: z.coerce.number().int().gte(1).lte(100),
});

/**
 * One board row.
 *
 * Deliberately shaped like the app's existing `LeaderRow` minus `isMe`, which the
 * client computes: the board response is shared by every caller and cached as one
 * body, so a per-caller field cannot be baked into it. `deviceId` is what makes
 * that computation possible.
 */
export interface LeaderboardRow {
  rank: number;
  deviceId: string;
  displayName: string;
  avatarSeed: string;
  score: number;
  bestStreak: number;
  achievedAt: string;
}

export interface LeaderboardResponse {
  scope: Scope;
  /** The season these rows belong to; the empty string for `all-time`. */
  seasonId: string;
  rows: LeaderboardRow[];
  /**
   * How stale the board is. The client shows it rather than pretending the
   * numbers are live — a leaderboard that claims to be current and is ten
   * minutes old is worse than one that says how old it is.
   */
  ageSeconds: number | null;
}

export const leaderboardRowSchema = z.object({
  rank: z.number(),
  deviceId: z.string(),
  displayName: z.string(),
  avatarSeed: z.string(),
  score: z.number(),
  bestStreak: z.number(),
  achievedAt: z.string(),
});

export const leaderboardResponseSchema = z.object({
  scope: scopeSchema,
  seasonId: z.string(),
  rows: z.array(leaderboardRowSchema),
  ageSeconds: z.number().nullable(),
});
