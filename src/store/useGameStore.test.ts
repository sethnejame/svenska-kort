import { beforeEach, describe, expect, it } from 'vitest';
import type { WordEntry } from '../types/word';
import { getEntry } from '../data/decks';
import { useGameStore } from './useGameStore';

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

describe('useGameStore', () => {
  beforeEach(() => {
    useGameStore.setState({ rng: () => 0.5 });
    store().startSession('fraser', 0);
  });

  it('starts on a prompt with a drawn card and a stop-list', () => {
    const state = store();
    expect(state.status).toBe('prompt');
    expect(state.currentId).not.toBeNull();
    expect(state.pool).toHaveLength(6);
    expect(state.allAnswers.has('everyone')).toBe(true);
    expect(state.startedAt).toBe(0);
  });

  it('drives a five-card deck from start to finish with no React', () => {
    // Trim to five, keeping the already-drawn card so the count stays exact.
    const { currentId, pool } = store();
    const ordered = [...pool].sort((a) => (a === currentId ? -1 : 0));
    useGameStore.setState({ pool: ordered.slice(0, 5) });

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
