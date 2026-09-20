import { create } from 'zustand';
import type { WordEntry } from '../types/word';
import type { WordStat } from '../types/progress';
import type { AnswerVerdict, Verdict } from '../lib/checkAnswer';
import { checkAnswer, collectAllAnswers } from '../lib/checkAnswer';
import { pointsFor } from '../lib/scoring';
import { selectNext } from '../lib/selectNext';
import { nextBox } from '../lib/leitner';
import { entriesForDeck, getEntry } from '../data/decks';

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
  recentIds: string[];
  promptShownAt: number;
  startedAt: number;
  endedAt: number | null;
  stats: Record<string, WordStat>;
  /** Stop-list for checkAnswer, built once per deck. */
  allAnswers: ReadonlySet<string>;
  rng: () => number;
}

export interface GameActions {
  startSession: (deckId: string, now: number) => void;
  setInput: (input: string) => void;
  submit: (now: number) => void;
  flip: () => void;
  skip: (now: number) => void;
  continue_: (now: number) => void;
  endSession: (now: number) => void;
}

const initialState: GameState = {
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
  recentIds: [],
  promptShownAt: 0,
  startedAt: 0,
  endedAt: null,
  stats: {},
  allAnswers: new Set<string>(),
  rng: Math.random,
};

function poolEntries(pool: readonly string[]): WordEntry[] {
  const entries: WordEntry[] = [];
  for (const id of pool) {
    const entry = getEntry(id);
    if (entry) entries.push(entry);
  }
  return entries;
}

function bumpStat(
  stats: Readonly<Record<string, WordStat>>,
  entryId: string,
  verdict: Verdict,
  now: number,
): Record<string, WordStat> {
  const previous = stats[entryId];
  const base: WordStat = previous ?? {
    entryId,
    seen: 0,
    correct: 0,
    wrong: 0,
    lastSeenAt: '',
    box: 1,
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
    },
  };
}

/** Draws the next card, or finishes the session when the pool is empty. */
function drawNext(state: GameState, now: number): Partial<GameState> {
  const entries = poolEntries(state.pool);
  if (entries.length === 0) {
    return { status: 'done', currentId: null, flipped: false, endedAt: now };
  }

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

  return {
    pool: state.pool.filter((id) => id !== entryId),
    answered: state.answered + 1,
    correct: state.correct + (verdict === 'correct' ? 1 : 0),
    stats: bumpStat(state.stats, entryId, verdict, now),
  };
}

export const useGameStore = create<GameState & GameActions>((set, get) => ({
  ...initialState,

  startSession: (deckId, now) => {
    const entries = entriesForDeck(deckId);
    const fresh: GameState = {
      ...initialState,
      rng: get().rng,
      deckId,
      pool: entries.map((entry) => entry.id),
      allAnswers: collectAllAnswers(entries),
      startedAt: now,
    };
    set({ ...fresh, ...drawNext(fresh, now) });
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

    const entry = getEntry(state.currentId);
    if (!entry) return;

    const result = checkAnswer(state.input, entry, state.allAnswers);

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
    set({ status: 'done', currentId: null, flipped: false, endedAt: now });
  },
}));
