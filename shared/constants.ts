/**
 * Limits both sides enforce.
 *
 * A cap that exists only on the client is a suggestion; a cap that exists only
 * on the server is a form that fails after the learner has typed. Every value
 * here is read by `shared/api.ts`, so the two sides cannot drift.
 */

/** Shown publicly on the leaderboard, so it has to fit a 375 px row. */
export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 20;

/** A `WordEntry` field-by-field. Over-length is rejected, never truncated. */
export const SWEDISH_MAX = 100;
export const ENGLISH_MAX = 100;
export const ENGLISH_ANSWERS_MAX = 8;
export const NOTE_MAX = 280;
export const EXAMPLE_MAX = 200;
export const TAGS_MAX = 6;

/** Deck sharing. 500 entries is seven times the largest built-in deck. */
export const DECK_NAME_MIN = 2;
export const DECK_NAME_MAX = 60;
export const DECK_ENTRIES_MAX = 500;

/** One session is ~4 KB; the cap is refused at the edge before any parsing. */
export const SESSION_ANSWERS_MAX = 500;
export const SESSION_BYTES_MAX = 64 * 1024;
export const SUGGESTION_BYTES_MAX = 8 * 1024;
export const SHARED_DECK_BYTES_MAX = 256 * 1024;

/** Long enough to read a code down a phone line, short enough to be useless later. */
export const TRANSFER_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * No `0/O`, no `1/I/L`. A transfer code gets read aloud and typed by hand, and
 * every ambiguous glyph turns into a support conversation.
 */
export const UNAMBIGUOUS_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Characters that never appear in Swedish, English or ordinary punctuation, and
 * that do appear in display names chosen to spoof or to break a layout: C0/C1
 * controls, zero-width joiners, and the bidirectional overrides.
 */
// eslint-disable-next-line no-control-regex
export const FORBIDDEN_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;
