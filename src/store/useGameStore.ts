import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { WordEntry } from '../types/word';
import type { Profile, SessionResult, WordStat } from '../types/progress';
import type { AnswerVerdict, Verdict } from '../lib/checkAnswer';
import {
  checkAnswer,
  checkSwedish,
  collectAllAnswers,
  collectAllSwedish,
} from '../lib/checkAnswer';
import type { SessionAnswer } from '../lib/scoring';
import { pointsFor } from '../lib/scoring';
import { selectNext } from '../lib/selectNext';
import { dueEntries, nextBox } from '../lib/leitner';
import { weakestEntries } from '../lib/weakest';
import { entriesForDeck, getEntry, WEAKEST_DECK } from '../data/decks';
import { useDeckStore } from './useDeckStore';
import {
  consumeRecoveryFlag,
  MAX_SESSION_HISTORY,
  persistedStorage,
  SCHEMA_VERSION,
  STORAGE_KEY,
} from './persisted';

/**
 * `Checking` and `Next` from the diagram are transient — they happen inside an
 * action and are never observable — so they are not statuses here.
 */
export type GameStatus = 'idle' | 'prompt' | 'close' | 'correct' | 'revealed' | 'done';

const RECENT_LIMIT = 20;

export interface GameState {
  status: GameStatus;
  deckId: string | null;
  /** Entry ids still unanswered this session. A session ends when it empties. */
  pool: string[];
  currentId: string | null;
  flipped: boolean;
  peeked: boolean;
  retryUsed: boolean;
  input: string;
  lastVerdict: AnswerVerdict | null;
  streak: number;
  bestStreakInSession: number;
  sessionScore: number;
  answered: number;
  correct: number;
  /** Per-answer record for this run, so a remote submit can be replayed server-side. */
  answersThisSession: (SessionAnswer & { entryId: string })[];
  recentIds: string[];
  promptShownAt: number;
  startedAt: number;
  endedAt: number | null;
  stats: Record<string, WordStat>;
  /** Stop-list for checkAnswer, built once per deck. */
  allAnswers: ReadonlySet<string>;
  /** The same, in Swedish, for reverse mode. */
  allSwedish: ReadonlySet<string>;
  rng: () => number;

  // Career state: survives a session, and is what actually gets persisted.
  schemaVersion: number;
  /** True when the prompt is English and the learner types Swedish. */
  reverse: boolean;
  /** Runs started, ever. The clock the Leitner schedule counts intervals in. */
  sessionCount: number;
  sessionHistory: SessionResult[];
  profile: Profile | null;
  bestStreakEver: number;
  totalScore: number;
  /** Set when the stored blob was unreadable and defaults were used. */
  storageRecovered: boolean;
}

export interface GameActions {
  startSession: (deckId: string, now: number) => void;
  setInput: (input: string) => void;
  submit: (now: number) => void;
  flip: () => void;
  skip: (now: number) => void;
  continue_: (now: number) => void;
  endSession: (now: number) => void;
  /** Takes effect from the next session, so a run is never graded both ways. */
  setReverse: (reverse: boolean) => void;
  saveProfile: (displayName: string, avatarSeed: string, now: number) => void;
  /** T14 import. The caller has already merged or replaced. */
  setProgress: (progress: {
    profile: Profile | null;
    stats: Record<string, WordStat>;
    sessionHistory: SessionResult[];
  }) => void;
  /** The recovery notice is persisted, so it needs an explicit way to go away. */
  dismissRecovery: () => void;
}

export const INITIAL_GAME_STATE: GameState = {
  status: 'idle',
  deckId: null,
  pool: [],
  currentId: null,
  flipped: false,
  peeked: false,
  retryUsed: false,
  input: '',
  lastVerdict: null,
  streak: 0,
  bestStreakInSession: 0,
  sessionScore: 0,
  answered: 0,
  correct: 0,
  answersThisSession: [],
  recentIds: [],
  promptShownAt: 0,
  startedAt: 0,
  endedAt: null,
  stats: {},
  allAnswers: new Set<string>(),
  allSwedish: new Set<string>(),
  rng: Math.random,
  schemaVersion: SCHEMA_VERSION,
  reverse: false,
  sessionCount: 0,
  sessionHistory: [],
  profile: null,
  bestStreakEver: 0,
  totalScore: 0,
  storageRecovered: false,
};

/** The fields a new session inherits: a learner's history, not their current run. */
function career(state: GameState) {
  return {
    rng: state.rng,
    stats: state.stats,
    sessionCount: state.sessionCount,
    sessionHistory: state.sessionHistory,
    profile: state.profile,
    bestStreakEver: state.bestStreakEver,
    totalScore: state.totalScore,
    storageRecovered: state.storageRecovered,
    schemaVersion: state.schemaVersion,
    reverse: state.reverse,
  };
}

/**
 * Read at call time, not captured, so a word added on `/add` is playable in the
 * very next session without a reload.
 */
function addedEntries(): WordEntry[] {
  return useDeckStore.getState().userEntries;
}

/**
 * What a deck offers this session. Every deck bar one is a tag over the
 * library; `svagast` is assembled from the learner's own record, which is why
 * it is worked out here rather than in the data module.
 */
function deckEntries(deckId: string, stats: Readonly<Record<string, WordStat>>): WordEntry[] {
  const added = addedEntries();
  if (deckId === WEAKEST_DECK.id) return weakestEntries(entriesForDeck('alla', added), stats);
  return entriesForDeck(deckId, added);
}

function poolEntries(pool: readonly string[]): WordEntry[] {
  const added = addedEntries();
  const entries: WordEntry[] = [];
  for (const id of pool) {
    const entry = getEntry(id, added);
    if (entry) entries.push(entry);
  }
  return entries;
}

function bumpStat(
  stats: Readonly<Record<string, WordStat>>,
  entryId: string,
  verdict: Verdict,
  now: number,
  session: number,
): Record<string, WordStat> {
  const previous = stats[entryId];
  const base: WordStat = previous ?? {
    entryId,
    seen: 0,
    correct: 0,
    wrong: 0,
    lastSeenAt: '',
    box: 1,
    lastSeenSession: 0,
  };

  return {
    ...stats,
    [entryId]: {
      ...base,
      seen: base.seen + 1,
      correct: base.correct + (verdict === 'correct' ? 1 : 0),
      wrong: base.wrong + (verdict === 'wrong' ? 1 : 0),
      lastSeenAt: new Date(now).toISOString(),
      box: nextBox(base.box, verdict),
      lastSeenSession: session,
    },
  };
}

/**
 * Closes out a session: banks the score and appends a SessionResult, keeping
 * the newest 50. A session nobody answered is not worth a row.
 */
function finishSession(state: GameState, now: number): Partial<GameState> {
  const ended = { status: 'done' as const, currentId: null, flipped: false, endedAt: now };
  if (state.answered === 0) return ended;

  const result: SessionResult = {
    id: crypto.randomUUID(),
    deckId: state.deckId ?? '',
    startedAt: new Date(state.startedAt).toISOString(),
    endedAt: new Date(now).toISOString(),
    answered: state.answered,
    correct: state.correct,
    bestStreak: state.bestStreakInSession,
    score: state.sessionScore,
    answers: state.answersThisSession,
  };

  return {
    ...ended,
    sessionHistory: [...state.sessionHistory, result].slice(-MAX_SESSION_HISTORY),
    totalScore: state.totalScore + state.sessionScore,
    bestStreakEver: Math.max(state.bestStreakEver, state.bestStreakInSession),
  };
}

/** Draws the next card, or finishes the session when the pool is empty. */
function drawNext(state: GameState, now: number): Partial<GameState> {
  const entries = poolEntries(state.pool);
  if (entries.length === 0) return finishSession(state, now);

  const entry = selectNext(entries, state.stats, state.recentIds, state.rng);
  return {
    status: 'prompt',
    currentId: entry.id,
    flipped: false,
    peeked: false,
    retryUsed: false,
    input: '',
    lastVerdict: null,
    promptShownAt: now,
    recentIds: [entry.id, ...state.recentIds].slice(0, RECENT_LIMIT),
  };
}

/** Retires the current card from the pool and folds it into the session counters. */
function resolveCard(state: GameState, verdict: Verdict, now: number): Partial<GameState> {
  const entryId = state.currentId;
  if (entryId === null) return {};

  const answer: SessionAnswer & { entryId: string } = {
    entryId,
    verdict,
    elapsedMs: now - state.promptShownAt,
    wasTyped: !state.peeked,
    acceptedOnRetry: state.retryUsed,
  };

  return {
    pool: state.pool.filter((id) => id !== entryId),
    answered: state.answered + 1,
    correct: state.correct + (verdict === 'correct' ? 1 : 0),
    stats: bumpStat(state.stats, entryId, verdict, now, state.sessionCount),
    answersThisSession: [...state.answersThisSession, answer],
  };
}

const createGame = (
  set: (partial: Partial<GameState & GameActions>) => void,
  get: () => GameState & GameActions,
): GameState & GameActions => ({
  ...INITIAL_GAME_STATE,

  startSession: (deckId, now) => {
    const state = get();
    const entries = deckEntries(deckId, state.stats);

    const unfinished = state.endedAt === null && state.answered > 0;

    // A reload lands here with the run still in the store. Picking the same
    // deck back up mid-run keeps the streak and score rather than charging the
    // learner for refreshing the page.
    if (unfinished && state.deckId === deckId && state.pool.length > 0) {
      const resumed: GameState = {
        ...state,
        allAnswers: collectAllAnswers(entries),
        allSwedish: collectAllSwedish(entries),
      };
      set({ ...resumed, ...drawNext(resumed, now) });
      return;
    }

    // Otherwise the previous run is over for good, so it is banked here rather
    // than when the Play route unmounts — a remount must not cost a session.
    const previous = unfinished ? { ...state, ...finishSession(state, now) } : state;

    const session = previous.sessionCount + 1;
    // The Leitner schedule decides what a session asks about. When everything
    // is resting the whole deck comes back instead: a learner who opens the app
    // wanting to practise is never told to come back in four sessions.
    const due = dueEntries(entries, previous.stats, session);
    const scheduled = due.length > 0 ? due : entries;

    const base: GameState = {
      ...INITIAL_GAME_STATE,
      ...career(previous),
      sessionCount: session,
      deckId,
      pool: scheduled.map((entry) => entry.id),
      // The stop-list stays the whole deck, not just what is due — `increased`
      // must read as wrong for `minskade` whether or not it is scheduled today.
      allAnswers: collectAllAnswers(entries),
      allSwedish: collectAllSwedish(entries),
      startedAt: now,
    };

    set({ ...base, ...drawNext(base, now) });
  },

  setInput: (input) => {
    const { status } = get();
    // A keystroke after a near miss puts the learner back on the prompt, but
    // `retryUsed` stays set so the second miss reveals instead of looping.
    if (status === 'close') {
      set({ input, status: 'prompt', lastVerdict: null });
      return;
    }
    set({ input });
  },

  submit: (now) => {
    const state = get();
    if (state.status !== 'prompt') return;
    if (state.currentId === null) return;
    // An accidental Enter on an empty field must not cost a streak.
    if (state.input.trim() === '') return;

    const entry = getEntry(state.currentId, addedEntries());
    if (!entry) return;

    const result = state.reverse
      ? checkSwedish(state.input, entry, state.allSwedish)
      : checkAnswer(state.input, entry, state.allAnswers);

    if (result.verdict === 'correct') {
      const wasTyped = !state.peeked;
      const points = pointsFor({
        verdict: 'correct',
        streak: state.streak,
        elapsedMs: now - state.promptShownAt,
        wasTyped,
        acceptedOnRetry: state.retryUsed,
      });
      // A peeked card keeps the streak but does not extend it.
      const streak = wasTyped ? state.streak + 1 : state.streak;

      set({
        ...resolveCard(state, 'correct', now),
        status: 'correct',
        flipped: true,
        lastVerdict: result,
        sessionScore: state.sessionScore + points,
        streak,
        bestStreakInSession: Math.max(state.bestStreakInSession, streak),
        // Tracked live, not at session end, so a reload cannot lose a record.
        bestStreakEver: Math.max(state.bestStreakEver, streak),
      });
      return;
    }

    if (result.verdict === 'close' && !state.retryUsed) {
      set({ status: 'close', retryUsed: true, lastVerdict: result });
      return;
    }

    // A second miss, or an outright wrong answer, reveals and breaks the streak.
    set({
      ...resolveCard(state, result.verdict, now),
      status: 'revealed',
      flipped: true,
      lastVerdict: result,
      streak: 0,
    });
  },

  flip: () => {
    const state = get();
    // Peeking before answering costs the points but not the streak. The card
    // stays on the prompt so the learner can still type the answer.
    if (state.status === 'prompt') {
      set({ flipped: !state.flipped, peeked: true });
      return;
    }
    set({ flipped: !state.flipped });
  },

  skip: (now) => {
    const state = get();
    if (state.status !== 'prompt' && state.status !== 'close') return;

    set({
      ...resolveCard(state, 'wrong', now),
      status: 'revealed',
      flipped: true,
      lastVerdict: null,
      streak: 0,
    });
  },

  continue_: (now) => {
    const state = get();
    if (state.status !== 'correct' && state.status !== 'revealed') return;
    set(drawNext(state, now));
  },

  endSession: (now) => {
    const state = get();
    if (state.status === 'idle' || state.status === 'done') return;
    set(finishSession(state, now));
  },

  setReverse: (reverse) => {
    set({ reverse });
  },

  saveProfile: (displayName, avatarSeed, now) => {
    const state = get();
    const name = displayName.trim();
    // The form rejects an empty name with a message; this is the last line.
    if (name === '') return;

    set({
      profile: {
        displayName: name,
        avatarSeed,
        // Setting up once and editing later must not reset the join date.
        createdAt: state.profile?.createdAt ?? new Date(now).toISOString(),
        // Snapshots for the leaderboard row. `totalScore` and `bestStreakEver`
        // on the store stay authoritative; these are written, never read back.
        totalScore: state.totalScore,
        bestStreakEver: state.bestStreakEver,
      },
    });
  },

  setProgress: ({ profile, stats, sessionHistory }) => {
    // The run in progress is abandoned: its pool may name entries the imported
    // library no longer has, and its score was earned against other stats.
    set({
      ...INITIAL_GAME_STATE,
      rng: get().rng,
      // The direction is how this learner likes to practise, not something the
      // file carries, so an import leaves it alone.
      reverse: get().reverse,
      profile,
      stats,
      // An imported library counts its intervals in the other device's
      // sessions. Taking the highest keeps those words resting rather than
      // making the whole import due the moment it lands.
      sessionCount: Math.max(
        get().sessionCount,
        ...Object.values(stats).map((stat) => stat.lastSeenSession),
      ),
      sessionHistory,
      totalScore: profile?.totalScore ?? 0,
      bestStreakEver: profile?.bestStreakEver ?? 0,
    });
  },

  dismissRecovery: () => {
    set({ storageRecovered: false });
  },
});

export const useGameStore = create<GameState & GameActions>()(
  persist(createGame, {
    name: STORAGE_KEY,
    version: SCHEMA_VERSION,
    storage: persistedStorage,
    // Mid-question state is deliberately absent: a reload draws a fresh card
    // rather than restoring a half-typed answer. The run itself survives.
    partialize: (state) => ({
      schemaVersion: SCHEMA_VERSION,
      reverse: state.reverse,
      stats: state.stats,
      sessionCount: state.sessionCount,
      sessionHistory: state.sessionHistory,
      profile: state.profile,
      bestStreakEver: state.bestStreakEver,
      totalScore: state.totalScore,
      deckId: state.deckId,
      pool: state.pool,
      streak: state.streak,
      bestStreakInSession: state.bestStreakInSession,
      sessionScore: state.sessionScore,
      answered: state.answered,
      correct: state.correct,
      answersThisSession: state.answersThisSession,
      startedAt: state.startedAt,
      endedAt: state.endedAt,
    }),
  }),
);

// Rehydration is synchronous, so by here the storage layer knows whether it had
// to fall back to defaults.
if (consumeRecoveryFlag()) useGameStore.setState({ storageRecovered: true });
