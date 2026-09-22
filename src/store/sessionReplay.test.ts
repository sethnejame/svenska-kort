/**
 * The drift test.
 *
 * `shared/scoring.ts` exists so the client and the Worker cannot disagree about
 * what a run was worth. `pointsFor` being shared is only half of that: the app
 * accumulates a score answer by answer as the learner plays, while the Worker
 * replays a finished array through `replaySession`, and those two are separate
 * pieces of code that have to arrive at the same number.
 *
 * So this plays real sessions through the real store, records exactly what it
 * fed in, and asserts that replaying that record produces the score the store
 * arrived at live. A change to the streak rule in either place fails here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { WordEntry } from '../types/word';
import { getEntry } from '../data/decks';
import { replaySession, type SessionAnswer } from '../../shared/scoring';
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

/** One substituted character: close enough to grade 'close', never an exact match. */
function typoOf(answer: string): string {
  const chars = Array.from(answer);
  const middle = Math.floor(chars.length / 2);
  chars[middle] = chars[middle] === 'x' ? 'q' : 'x';
  return chars.join('');
}

const NONSENSE = 'qqqqqqqqq';

/**
 * Plays one card and returns what the submission would have reported for it.
 *
 * The returned values are read off the store as it was *before* the submit, not
 * invented: `wasTyped` is the real `peeked`, `acceptedOnRetry` is the real
 * `retryUsed`, and `elapsedMs` is the real gap from `promptShownAt`. That is
 * what makes the comparison meaningful rather than circular.
 */
function play(
  kind: 'correct' | 'peeked' | 'retry' | 'wrong' | 'close',
  elapsedMs: number,
): SessionAnswer {
  const shownAt = store().promptShownAt;
  const now = shownAt + elapsedMs;
  const answer = firstAnswer(current());

  if (kind === 'peeked') store().flip();
  if (kind === 'retry' || kind === 'close') {
    // A first near-miss: the store sets `retryUsed` and stays on the prompt.
    store().setInput(typoOf(answer));
    store().submit(now);
  }

  const { peeked, retryUsed } = store();

  store().setInput(
    kind === 'wrong' ? NONSENSE : kind === 'close' ? typoOf(answer) : answer,
  );
  store().submit(now);

  const verdict = kind === 'wrong' ? 'wrong' : kind === 'close' ? 'close' : 'correct';
  store().continue_(now + 1);

  return { verdict, elapsedMs, wasTyped: !peeked, acceptedOnRetry: retryUsed };
}

beforeEach(() => {
  useGameStore.setState({ ...INITIAL_GAME_STATE, rng: () => 0.5 });
  store().startSession('fraser', 0);
});

describe('the store and replaySession agree', () => {
  it('on a run of plain correct answers through the multiplier steps', () => {
    const answers = Array.from({ length: 12 }, () => play('correct', 5000));

    expect(replaySession(answers).score).toBe(store().sessionScore);
    expect(replaySession(answers).bestStreak).toBe(store().bestStreakInSession);
  });

  it('on a run where the speed bonus comes and goes', () => {
    const answers = [
      play('correct', 1000),
      play('correct', 9000),
      play('correct', 3999),
      play('correct', 4001),
    ];

    expect(replaySession(answers).score).toBe(store().sessionScore);
  });

  it('on a peek in the middle of a streak, which pays nothing and breaks nothing', () => {
    const answers = [
      ...Array.from({ length: 5 }, () => play('correct', 5000)),
      play('peeked', 5000),
      play('correct', 5000),
    ];

    expect(replaySession(answers).score).toBe(store().sessionScore);
    expect(replaySession(answers).bestStreak).toBe(store().bestStreakInSession);
  });

  it('on a typo accepted on retry, which pays base points and still extends the streak', () => {
    const answers = [
      ...Array.from({ length: 5 }, () => play('correct', 5000)),
      play('retry', 5000),
      play('correct', 5000),
    ];

    expect(replaySession(answers).score).toBe(store().sessionScore);
    expect(replaySession(answers).bestStreak).toBe(store().bestStreakInSession);
  });

  it('on a wrong answer that resets the multiplier mid-run', () => {
    const answers = [
      ...Array.from({ length: 7 }, () => play('correct', 2000)),
      play('wrong', 5000),
      ...Array.from({ length: 6 }, () => play('correct', 2000)),
    ];

    expect(replaySession(answers).score).toBe(store().sessionScore);
    expect(replaySession(answers).bestStreak).toBe(store().bestStreakInSession);
  });

  it('on a second near-miss, which reveals and resets like any other miss', () => {
    const answers = [
      ...Array.from({ length: 5 }, () => play('correct', 2000)),
      play('close', 5000),
      play('correct', 2000),
    ];

    expect(replaySession(answers).score).toBe(store().sessionScore);
    expect(replaySession(answers).bestStreak).toBe(store().bestStreakInSession);
  });

  it('on a long mixed run, every kind of answer interleaved', () => {
    const kinds = ['correct', 'correct', 'peeked', 'correct', 'retry', 'wrong', 'correct', 'close'] as const;
    const answers: SessionAnswer[] = [];
    for (let i = 0; i < 40; i += 1) {
      answers.push(play(kinds[i % kinds.length] ?? 'correct', 1000 + (i % 9) * 1000));
    }

    expect(replaySession(answers).score).toBe(store().sessionScore);
    expect(replaySession(answers).bestStreak).toBe(store().bestStreakInSession);
    expect(replaySession(answers).answered).toBe(store().answered);
    expect(replaySession(answers).correct).toBe(store().correct);
  });
});
