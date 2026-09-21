import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WordEntry } from '../types/word';
import type { SessionResult } from '../types/progress';
import { entriesForDeck, getEntry } from '../data/decks';
import { consumeRecoveryFlag, MAX_SESSION_HISTORY, STORAGE_KEY } from './persisted';
import { resetStorageForTests } from './storage';
import { INITIAL_GAME_STATE, useGameStore } from './useGameStore';

const store = () => useGameStore.getState();

function current(): WordEntry {
  const id = store().currentId;
  if (id === null) throw new Error('no current card');
  const entry = getEntry(id);
  if (!entry) throw new Error(`missing entry ${id}`);
  return entry;
}

function firstAnswer(entry: WordEntry): string {
  const answer = entry.english[0];
  if (answer === undefined) throw new Error(`${entry.id} has no answer`);
  return answer;
}

/** One substituted character: close enough for the fuzzy tier, never an exact match. */
function typoOf(answer: string): string {
  const chars = Array.from(answer);
  const middle = Math.floor(chars.length / 2);
  chars[middle] = chars[middle] === 'x' ? 'q' : 'x';
  return chars.join('');
}

function typeAndSubmit(text: string, now: number): void {
  store().setInput(text);
  store().submit(now);
}

function answerCorrectly(now: number): void {
  typeAndSubmit(firstAnswer(current()), now);
}

/** A string that matches nothing: too far for fuzzy, not a substring of anything. */
const NONSENSE = 'qqqqqqqqq';

const FRASER_SIZE = entriesForDeck('fraser').length;

/**
 * `fraser` holds every phrase in the app, which is far more cards than a test
 * wants to type through. Trimming the pool keeps the already-drawn card so
 * `currentId` stays valid, and keeps these tests off the deck's real size.
 */
function trimPoolTo(size: number): void {
  const { currentId, pool } = store();
  const ordered = [...pool].sort((a) => (a === currentId ? -1 : 0));
  useGameStore.setState({ pool: ordered.slice(0, size) });
}

describe('useGameStore', () => {
  beforeEach(() => {
    // A full reset, not just the rng: the store now resumes an unfinished run,
    // so leftover state from a previous test would be picked back up.
    useGameStore.setState({ ...INITIAL_GAME_STATE, rng: () => 0.5 });
    store().startSession('fraser', 0);
  });

  it('starts on a prompt with a drawn card and a stop-list', () => {
    const state = store();
    expect(state.status).toBe('prompt');
    expect(state.currentId).not.toBeNull();
    expect(state.pool).toHaveLength(FRASER_SIZE);
    expect(state.allAnswers.has('everyone')).toBe(true);
    expect(state.startedAt).toBe(0);
  });

  it('drives a five-card deck from start to finish with no React', () => {
    trimPoolTo(5);

    for (let card = 1; card <= 5; card += 1) {
      expect(store().status).toBe('prompt');
      answerCorrectly(card * 1000);
      expect(store().status).toBe('correct');
      store().continue_(card * 1000 + 100);
    }

    const state = store();
    expect(state.status).toBe('done');
    expect(state.answered).toBe(5);
    expect(state.correct).toBe(5);
    expect(state.pool).toHaveLength(0);
    expect(state.currentId).toBeNull();
  });

  it('leaves the streak at 1 after correct, correct, wrong, correct', () => {
    answerCorrectly(1000);
    store().continue_(1100);
    answerCorrectly(2000);
    store().continue_(2100);

    expect(store().streak).toBe(2);

    typeAndSubmit(NONSENSE, 3000);
    expect(store().status).toBe('revealed');
    expect(store().streak).toBe(0);
    store().continue_(3100);

    answerCorrectly(4000);

    const state = store();
    expect(state.streak).toBe(1);
    expect(state.bestStreakInSession).toBe(2);
    // Three correct answers, each inside the 4s speed window at a 1x multiplier.
    expect(state.sessionScore).toBe(45);
    expect(state.answered).toBe(4);
    expect(state.correct).toBe(3);
  });

  it('keeps the streak and scores base points when a close answer is fixed on retry', () => {
    answerCorrectly(1000);
    store().continue_(1100);
    const scoreAfterFirst = store().sessionScore;

    const answer = firstAnswer(current());
    typeAndSubmit(typoOf(answer), 2000);

    expect(store().status).toBe('close');
    expect(store().retryUsed).toBe(true);
    expect(store().lastVerdict?.verdict).toBe('close');

    // A keystroke puts the learner back on the prompt without clearing retryUsed.
    store().setInput(answer);
    expect(store().status).toBe('prompt');
    expect(store().retryUsed).toBe(true);

    store().submit(2500);

    const state = store();
    expect(state.status).toBe('correct');
    expect(state.streak).toBe(2);
    expect(state.sessionScore - scoreAfterFirst).toBe(10);
  });

  it('reveals after two misses on the same card, with no third retry', () => {
    const answer = firstAnswer(current());

    typeAndSubmit(typoOf(answer), 1000);
    expect(store().status).toBe('close');

    store().setInput(typoOf(answer) + 'x');
    store().submit(2000);

    const state = store();
    expect(state.status).toBe('revealed');
    expect(state.streak).toBe(0);
    expect(state.answered).toBe(1);
  });

  it('scores zero and leaves the streak untouched when the card was flipped first', () => {
    answerCorrectly(1000);
    store().continue_(1100);

    const scoreAfterFirst = store().sessionScore;
    expect(store().streak).toBe(1);

    store().flip();
    expect(store().peeked).toBe(true);
    expect(store().flipped).toBe(true);

    answerCorrectly(1200);

    const state = store();
    expect(state.sessionScore).toBe(scoreAfterFirst);
    expect(state.streak).toBe(1);
    expect(state.correct).toBe(2);
  });

  it('ignores submit once the card is revealed', () => {
    typeAndSubmit(NONSENSE, 1000);
    expect(store().status).toBe('revealed');

    const before = store().sessionScore;
    const answer = firstAnswer(current());
    typeAndSubmit(answer, 1100);

    expect(store().status).toBe('revealed');
    expect(store().sessionScore).toBe(before);
    expect(store().answered).toBe(1);
  });

  it('ignores an empty submit so a stray Enter cannot break a streak', () => {
    answerCorrectly(1000);
    store().continue_(1100);

    typeAndSubmit('   ', 1200);

    expect(store().status).toBe('prompt');
    expect(store().streak).toBe(1);
    expect(store().answered).toBe(1);
  });

  it('treats a skip as a miss: revealed, no score, streak gone', () => {
    answerCorrectly(1000);
    store().continue_(1100);
    const score = store().sessionScore;

    store().skip(1200);

    const state = store();
    expect(state.status).toBe('revealed');
    expect(state.streak).toBe(0);
    expect(state.sessionScore).toBe(score);
    expect(state.answered).toBe(2);
    expect(state.correct).toBe(1);
  });

  it('ignores a skip that arrives after the card already resolved', () => {
    typeAndSubmit(NONSENSE, 1000);
    expect(store().answered).toBe(1);

    store().skip(1100);
    expect(store().answered).toBe(1);
  });

  it('reaches done exactly once and stops advancing', () => {
    trimPoolTo(6);
    for (let card = 1; card <= 6; card += 1) {
      answerCorrectly(card * 1000);
      store().continue_(card * 1000 + 100);
    }

    expect(store().status).toBe('done');
    expect(store().endedAt).toBe(6100);

    store().continue_(99000);
    store().submit(99000);

    expect(store().status).toBe('done');
    expect(store().endedAt).toBe(6100);
    expect(store().answered).toBe(6);
  });

  it('ends a session early on request, and only while one is running', () => {
    store().endSession(5000);
    expect(store().status).toBe('done');
    expect(store().endedAt).toBe(5000);

    store().endSession(6000);
    expect(store().endedAt).toBe(5000);
  });

  it('does nothing when endSession is called before a session starts', () => {
    useGameStore.setState({ status: 'idle', endedAt: null });
    store().endSession(5000);
    expect(store().status).toBe('idle');
    expect(store().endedAt).toBeNull();
  });

  it('records leitner boxes and counters per entry', () => {
    const firstId = current().id;
    answerCorrectly(1000);
    store().continue_(1100);

    const stat = store().stats[firstId];
    expect(stat).toMatchObject({ entryId: firstId, seen: 1, correct: 1, wrong: 0, box: 2 });
    expect(stat?.lastSeenAt).toBe(new Date(1000).toISOString());

    const secondId = current().id;
    typeAndSubmit(NONSENSE, 2000);
    expect(store().stats[secondId]).toMatchObject({ seen: 1, correct: 0, wrong: 1, box: 1 });
  });

  it('toggles the card back over without clearing peeked', () => {
    store().flip();
    store().flip();

    expect(store().flipped).toBe(false);
    expect(store().peeked).toBe(true);
  });

  it('flips a revealed card without marking it peeked', () => {
    typeAndSubmit(NONSENSE, 1000);
    expect(store().flipped).toBe(true);

    store().flip();
    expect(store().flipped).toBe(false);
    expect(store().peeked).toBe(false);
  });

  it('finishes immediately for a deck that does not exist', () => {
    store().startSession('ingen-deck', 0);

    expect(store().status).toBe('done');
    expect(store().currentId).toBeNull();
  });
});

/**
 * Drops everything the store holds in memory, the way a page reload would.
 * The blob is snapshotted first because clearing the store writes through the
 * persist middleware, which would otherwise overwrite what we mean to restore.
 */
function reload(): void {
  const raw = localStorage.getItem(STORAGE_KEY);
  useGameStore.setState({ ...INITIAL_GAME_STATE, rng: () => 0.5 });
  if (raw !== null) localStorage.setItem(STORAGE_KEY, raw);
  // Typed as thenable, but runs to completion synchronously for sync storage.
  void useGameStore.persist.rehydrate();
}

function fakeHistory(count: number): SessionResult[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `session-${index}`,
    deckId: 'fraser',
    startedAt: new Date(index).toISOString(),
    endedAt: new Date(index + 1).toISOString(),
    answered: 1,
    correct: 1,
    bestStreak: 1,
    score: 1,
  }));
}

describe('useGameStore scheduling', () => {
  beforeEach(() => {
    useGameStore.setState({ ...INITIAL_GAME_STATE, rng: () => 0.5 });
  });

  it('counts every run it starts', () => {
    store().startSession('fraser', 0);
    expect(store().sessionCount).toBe(1);

    store().endSession(1000);
    store().startSession('fraser', 2000);
    expect(store().sessionCount).toBe(2);
  });

  it('does not count a resumed run twice', () => {
    store().startSession('fraser', 0);
    answerCorrectly(1000);
    store().continue_(1100);

    store().startSession('fraser', 1200);

    expect(store().sessionCount).toBe(1);
  });

  it('leaves a word out of the next session until its box interval is up', () => {
    store().startSession('fraser', 0);
    const answeredId = current().id;
    answerCorrectly(1000);
    store().endSession(1500);

    // Box 2 rests two sessions, so the next run skips it and the one after does not.
    store().startSession('fraser', 2000);
    expect(store().pool).not.toContain(answeredId);

    store().endSession(2500);
    store().startSession('fraser', 3000);
    expect(store().pool).toContain(answeredId);
  });

  it('brings the whole deck back rather than offering nothing to practise', () => {
    store().startSession('fraser', 0);
    const size = store().pool.length;
    // Every word in the deck answered, all of them now resting.
    for (let card = 1; card <= size; card += 1) {
      answerCorrectly(card * 1000);
      store().continue_(card * 1000 + 100);
    }
    expect(store().status).toBe('done');

    store().startSession('fraser', 999000);

    expect(store().pool).toHaveLength(size);
  });

  it('keeps the stop-list on the whole deck, not just what is due', () => {
    store().startSession('fraser', 0);
    const full = store().allAnswers.size;
    answerCorrectly(1000);
    store().endSession(1500);

    store().startSession('fraser', 2000);

    expect(store().pool.length).toBeLessThan(FRASER_SIZE);
    expect(store().allAnswers.size).toBe(full);
  });
});

describe('useGameStore persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    resetStorageForTests();
    useGameStore.setState({ ...INITIAL_GAME_STATE, rng: () => 0.5 });
  });

  afterEach(() => {
    localStorage.clear();
    resetStorageForTests();
  });

  it('resumes a mid-session run with stats, streak, score and best-ever intact', () => {
    store().startSession('fraser', 0);
    trimPoolTo(6);

    const seen: string[] = [];
    for (let card = 1; card <= 5; card += 1) {
      seen.push(current().id);
      answerCorrectly(card * 1000);
      store().continue_(card * 1000 + 100);
    }

    const before = store();
    expect(before.status).toBe('prompt');
    expect(before.streak).toBe(5);
    expect(before.bestStreakEver).toBe(5);

    reload();
    store().startSession('fraser', 9000);

    const after = store();
    expect(after.answered).toBe(5);
    expect(after.correct).toBe(5);
    expect(after.streak).toBe(5);
    expect(after.sessionScore).toBe(before.sessionScore);
    expect(after.bestStreakEver).toBe(5);
    expect(after.startedAt).toBe(0);
    // The run continues rather than restarting: the answered cards stay retired.
    expect(after.pool).toHaveLength(1);
    for (const id of seen) expect(after.stats[id]?.seen).toBe(1);
    // A reload draws a fresh card rather than restoring a half-typed answer.
    expect(after.status).toBe('prompt');
    expect(after.input).toBe('');
  });

  it('starts fresh when the learner picks a different deck, keeping career stats', () => {
    store().startSession('fraser', 0);
    answerCorrectly(1000);
    store().continue_(1100);

    const stats = store().stats;
    reload();
    store().startSession('vardag', 9000);

    const after = store();
    expect(after.deckId).toBe('vardag');
    expect(after.answered).toBe(0);
    expect(after.streak).toBe(0);
    expect(after.sessionScore).toBe(0);
    expect(after.startedAt).toBe(9000);
    expect(after.stats).toEqual(stats);
    expect(after.bestStreakEver).toBe(1);
    // The abandoned run is banked on the way out rather than silently dropped.
    expect(after.sessionHistory).toHaveLength(1);
    expect(after.sessionHistory[0]).toMatchObject({ deckId: 'fraser', answered: 1 });
    expect(after.totalScore).toBeGreaterThan(0);
  });

  it('survives a remount that restarts the same deck mid-run', () => {
    store().startSession('fraser', 0);
    answerCorrectly(1000);
    store().continue_(1100);

    // What StrictMode does: mount, unmount, mount again.
    store().startSession('fraser', 1200);
    store().startSession('fraser', 1300);

    const state = store();
    expect(state.answered).toBe(1);
    expect(state.streak).toBe(1);
    expect(state.startedAt).toBe(0);
    expect(state.sessionHistory).toHaveLength(0);
  });

  it('starts fresh rather than resuming a session that already ended', () => {
    store().startSession('fraser', 0);
    answerCorrectly(1000);
    store().endSession(1500);

    reload();
    store().startSession('fraser', 9000);

    expect(store().answered).toBe(0);
    // A fresh run: everything is back in the pool bar the card just answered,
    // which the schedule is now resting.
    expect(store().pool).toHaveLength(FRASER_SIZE - 1);
    expect(store().totalScore).toBeGreaterThan(0);
  });

  it('banks the session into history and the career total when it finishes', () => {
    store().startSession('fraser', 0);
    trimPoolTo(6);
    for (let card = 1; card <= 6; card += 1) {
      answerCorrectly(card * 1000);
      store().continue_(card * 1000 + 100);
    }

    const state = store();
    expect(state.status).toBe('done');
    expect(state.sessionHistory).toHaveLength(1);
    expect(state.sessionHistory[0]).toMatchObject({
      deckId: 'fraser',
      answered: 6,
      correct: 6,
      bestStreak: 6,
      score: state.sessionScore,
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(6100).toISOString(),
    });
    expect(state.totalScore).toBe(state.sessionScore);
    expect(state.bestStreakEver).toBe(6);
  });

  it('drops the oldest row when the 51st session lands', () => {
    useGameStore.setState({ sessionHistory: fakeHistory(MAX_SESSION_HISTORY) });
    store().startSession('fraser', 0);
    answerCorrectly(1000);
    store().endSession(1500);

    const history = store().sessionHistory;
    expect(history).toHaveLength(MAX_SESSION_HISTORY);
    expect(history[0]?.id).toBe('session-1');
    expect(history.at(-1)?.deckId).toBe('fraser');
  });

  it('does not write a row for a session nobody answered', () => {
    store().startSession('fraser', 0);
    store().endSession(1000);

    expect(store().sessionHistory).toHaveLength(0);
    expect(store().totalScore).toBe(0);
  });

  it('moves the leitner box up on correct, holds on close, resets on wrong', () => {
    store().startSession('fraser', 0);

    // Pinned rather than whatever the deck draws: the close tier is a ratio, so a
    // one-character typo only lands there on an answer of a few words.
    const id = 'trevligt-att-traffas-phrase';
    useGameStore.setState({ pool: [id], currentId: id, status: 'prompt', retryUsed: false });

    // Correct twice on the same entry: box 1 → 2 → 3.
    answerCorrectly(1000);
    expect(store().stats[id]?.box).toBe(2);

    useGameStore.setState({ pool: [id], currentId: id, status: 'prompt', retryUsed: false });
    answerCorrectly(2000);
    expect(store().stats[id]?.box).toBe(3);

    // Two near misses in a row resolve the card as close, which holds the box.
    useGameStore.setState({ pool: [id], currentId: id, status: 'prompt', retryUsed: false });
    const answer = firstAnswer(current());
    typeAndSubmit(typoOf(answer), 3000);
    store().setInput(typoOf(answer) + 'x');
    store().submit(3100);
    expect(store().stats[id]).toMatchObject({ box: 3, seen: 3, correct: 2, wrong: 0 });

    // Outright wrong drops straight back to box 1.
    useGameStore.setState({ pool: [id], currentId: id, status: 'prompt', retryUsed: false });
    typeAndSubmit(NONSENSE, 4000);
    expect(store().stats[id]).toMatchObject({ box: 1, seen: 4, wrong: 1 });
  });

  it('loads with defaults and a recovery flag when the stored blob is garbage', () => {
    localStorage.setItem(STORAGE_KEY, '{{{');

    expect(() => {
      void useGameStore.persist.rehydrate();
    }).not.toThrow();
    if (consumeRecoveryFlag()) useGameStore.setState({ storageRecovered: true });

    const state = store();
    expect(state.storageRecovered).toBe(true);
    expect(state.stats).toEqual({});
    expect(state.sessionHistory).toEqual([]);
    expect(state.totalScore).toBe(0);
  });

  it('keeps a schemaVersion 99 blob rather than wiping it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { totalScore: 250, bestStreakEver: 12 }, version: 99 }),
    );

    void useGameStore.persist.rehydrate();

    expect(store().totalScore).toBe(250);
    expect(store().bestStreakEver).toBe(12);
    expect(consumeRecoveryFlag()).toBe(false);
    warn.mockRestore();
  });
});
