import { SPEED_BONUS_UNDER_MS } from './scoring';

/**
 * The nine badges, and what earns each one.
 *
 * Awarded server-side in `worker/src/session.ts` (all but `top-ten`, awarded by the cron
 * handler in `worker/src/badges.ts` at a season boundary — see that file for why no
 * boundary-detection state is needed). Every predicate here takes primitives only, never a
 * `Device` or a D1 row, so it stays testable with no network and reusable by the client's badge
 * shelf for locked-state copy.
 */
export const BADGE_IDS = [
  'first-session',
  'streak-10',
  'streak-25',
  'perfect-deck',
  'speed-demon',
  'week-warrior',
  'all-decks',
  'hundred-words',
  'top-ten',
] as const;

export type BadgeId = (typeof BADGE_IDS)[number];

export interface BadgeMeta {
  /** The badge's own name, shown on an earned tile. */
  name: string;
  /** Shown on a locked tile in place of the name — the condition, in Swedish. */
  condition: string;
}

export const BADGE_META: Record<BadgeId, BadgeMeta> = {
  'first-session': { name: 'Första steget', condition: 'Spela din första session.' },
  'streak-10': { name: 'Tioslag', condition: 'Nå en svit på 10 i en session.' },
  'streak-25': { name: 'Tjugofemma', condition: 'Nå en svit på 25 i en session.' },
  'perfect-deck': {
    name: 'Felfri',
    condition: 'Svara rätt på minst 10 kort i en session utan ett enda fel.',
  },
  'speed-demon': {
    name: 'Blixtsnabb',
    condition: 'Skriv 10 rätta svar på under 4 sekunder styck, i en session.',
  },
  'week-warrior': { name: 'Veckokämpe', condition: 'Spela minst en session 5 olika dagar på en vecka.' },
  'all-decks': { name: 'Upptäckaren', condition: 'Spela en session i varje ämneslek.' },
  'hundred-words': { name: 'Hundra ord', condition: 'Svara rätt på 100 olika ord, någon gång.' },
  'top-ten': { name: 'Topp tio', condition: 'Sluta en vecka bland de tio bästa på topplistan.' },
};

/**
 * The topic decks `all-decks` counts. Hardcoded rather than imported, because `shared/` imports
 * neither `src/` nor `worker/` (see CLAUDE.md's one-way arrows) — `src/data/decks.test.ts` cross-
 * checks this list against `BUILTIN_DECKS` so the two cannot silently drift apart.
 *
 * Excludes `alla` (the whole-dictionary aggregate, which trivially overlaps every topic) and
 * `svagast` (the dynamic weakest-words deck, never a `BUILTIN_DECK` at all).
 */
export const ALL_DECK_TOPIC_IDS = [
  'nyheter',
  'skola',
  'vardag',
  'fraser',
  'verb',
  'siffror',
  'farger',
  'tid',
  'mat',
  'familj',
  'kropp',
  'klader',
  'hem',
  'djur',
  'natur',
  'stad',
  'resa',
  'jobb',
] as const;

const STREAK_10_THRESHOLD = 10;
const STREAK_25_THRESHOLD = 25;
const PERFECT_DECK_MIN_ANSWERS = 10;
const SPEED_DEMON_COUNT = 10;
const WEEK_WARRIOR_DAYS = 5;
const HUNDRED_WORDS_THRESHOLD = 100;

/** True the moment a device's very first credited session is stored. */
export function isFirstSession(hadNoPriorSessions: boolean): boolean {
  return hadNoPriorSessions;
}

export function hasStreak(sessionBestStreak: number, threshold: number): boolean {
  return sessionBestStreak >= threshold;
}

export function isStreak10(sessionBestStreak: number): boolean {
  return hasStreak(sessionBestStreak, STREAK_10_THRESHOLD);
}

export function isStreak25(sessionBestStreak: number): boolean {
  return hasStreak(sessionBestStreak, STREAK_25_THRESHOLD);
}

/**
 * "A full deck at 100%." The Worker cannot know a deck's true size — deck data lives on the
 * device, never the Worker (see `worker/src/session.ts`'s own note on this limitation for
 * grading) — so this is approximated from the session's own numbers: enough answers to not be a
 * fluke, all of them correct.
 */
export function isPerfectDeck(answered: number, correct: number): boolean {
  return answered >= PERFECT_DECK_MIN_ANSWERS && correct === answered;
}

interface SpeedAnswer {
  verdict: string;
  wasTyped: boolean;
  elapsedMs: number;
}

export function isSpeedDemon(answers: readonly SpeedAnswer[]): boolean {
  const fast = answers.filter(
    (answer) => answer.verdict === 'correct' && answer.wasTyped && answer.elapsedMs < SPEED_BONUS_UNDER_MS,
  );
  return fast.length >= SPEED_DEMON_COUNT;
}

export function hasWeekWarrior(distinctDaysThisSeason: number): boolean {
  return distinctDaysThisSeason >= WEEK_WARRIOR_DAYS;
}

export function hasAllDecks(decksPlayed: readonly string[]): boolean {
  return decksPlayed.length >= ALL_DECK_TOPIC_IDS.length;
}

export function hasHundredWords(distinctCorrect: number): boolean {
  return distinctCorrect >= HUNDRED_WORDS_THRESHOLD;
}
