import { describe, expect, it } from 'vitest';
import {
  multiplier,
  packAnswers,
  pointsFor,
  replaySession,
  unpackAnswers,
  type SessionAnswer,
} from './scoring';

const typed = { verdict: 'correct' as const, wasTyped: true, acceptedOnRetry: false };
const slow = { elapsedMs: 10_000 };

describe('multiplier', () => {
  it('grows every five and caps at 3x', () => {
    expect(multiplier(0)).toBe(1);
    expect(multiplier(4)).toBe(1);
    expect(multiplier(5)).toBe(1.5);
    expect(multiplier(10)).toBe(2);
    expect(multiplier(25)).toBe(3);
    expect(multiplier(100)).toBe(3);
  });
});

describe('pointsFor', () => {
  it('pays base points times the streak multiplier', () => {
    expect(pointsFor({ ...typed, ...slow, streak: 0 })).toBe(10);
    expect(pointsFor({ ...typed, ...slow, streak: 5 })).toBe(15);
    expect(pointsFor({ ...typed, ...slow, streak: 10 })).toBe(20);
    expect(pointsFor({ ...typed, ...slow, streak: 25 })).toBe(30);
    expect(pointsFor({ ...typed, ...slow, streak: 100 })).toBe(30);
  });

  it('adds the speed bonus just under four seconds and not just over', () => {
    expect(pointsFor({ ...typed, streak: 0, elapsedMs: 3999 })).toBe(15);
    expect(pointsFor({ ...typed, streak: 0, elapsedMs: 4001 })).toBe(10);
  });

  it('never pays the speed bonus on a flipped card', () => {
    expect(pointsFor({ ...typed, wasTyped: false, streak: 0, elapsedMs: 1000 })).toBe(0);
  });

  it('pays base points with no multiplier growth when a typo is accepted on retry', () => {
    expect(pointsFor({ ...typed, acceptedOnRetry: true, streak: 25, elapsedMs: 1000 })).toBe(10);
  });

  it('pays nothing for close or wrong', () => {
    expect(pointsFor({ ...typed, ...slow, verdict: 'close', streak: 10 })).toBe(0);
    expect(pointsFor({ ...typed, ...slow, verdict: 'wrong', streak: 10 })).toBe(0);
  });
});

describe('replaySession', () => {
  const answer = (over: Partial<SessionAnswer> = {}): SessionAnswer => ({
    verdict: 'correct',
    elapsedMs: 10_000,
    wasTyped: true,
    acceptedOnRetry: false,
    ...over,
  });

  it('is zero for a session with no answers, and does not throw', () => {
    expect(replaySession([])).toEqual({ score: 0, answered: 0, correct: 0, bestStreak: 0 });
  });

  it('prices each answer against the streak before it, not after', () => {
    // Five slow correct answers: the multiplier only reaches 1.5x on the sixth,
    // so this is 5 x 10 and not 4 x 10 + 15. Off by one here is off by one on
    // every session the app has ever scored.
    expect(replaySession(Array.from({ length: 5 }, () => answer())).score).toBe(50);
    expect(replaySession(Array.from({ length: 6 }, () => answer())).score).toBe(65);
  });

  it('breaks the streak on a wrong answer and starts the multiplier again', () => {
    const answers = [
      ...Array.from({ length: 5 }, () => answer()),
      answer({ verdict: 'wrong' }),
      answer(),
    ];
    // 50 for the first five, 0 for the miss, then 10 rather than 15.
    expect(replaySession(answers).score).toBe(60);
    expect(replaySession(answers).bestStreak).toBe(5);
  });

  it('keeps the streak through a peeked answer without extending it', () => {
    const answers = [
      ...Array.from({ length: 5 }, () => answer()),
      answer({ wasTyped: false }),
      answer(),
    ];
    // The peek pays nothing and adds nothing to the streak, but does not reset
    // it: the seventh answer is still the sixth of the streak, worth 15.
    expect(replaySession(answers).score).toBe(65);
    expect(replaySession(answers).bestStreak).toBe(6);
  });

  it('counts a peeked correct answer as correct even though it pays nothing', () => {
    const totals = replaySession([answer({ wasTyped: false })]);
    expect(totals).toEqual({ score: 0, answered: 1, correct: 1, bestStreak: 0 });
  });

  it('reports the best streak from the middle of a session, not the last one', () => {
    const answers = [
      ...Array.from({ length: 7 }, () => answer()),
      answer({ verdict: 'wrong' }),
      answer(),
    ];
    expect(replaySession(answers).bestStreak).toBe(7);
  });

  it('counts close as a miss — it resolved as one', () => {
    const totals = replaySession([answer(), answer({ verdict: 'close' })]);
    expect(totals).toEqual({ score: 10, answered: 2, correct: 1, bestStreak: 1 });
  });
});

describe('packAnswers / unpackAnswers', () => {
  const full = {
    entryId: 'regering-noun',
    verdict: 'close' as const,
    elapsedMs: 2500,
    wasTyped: true,
    acceptedOnRetry: true,
  };

  it('round-trips every field', () => {
    expect(unpackAnswers(packAnswers([full]))).toEqual([full]);
  });

  it('round-trips each flag combination independently', () => {
    for (const wasTyped of [true, false]) {
      for (const acceptedOnRetry of [true, false]) {
        const answer = { ...full, wasTyped, acceptedOnRetry };
        expect(unpackAnswers(packAnswers([answer]))).toEqual([answer]);
      }
    }
  });

  it('round-trips every verdict', () => {
    for (const verdict of ['correct', 'close', 'wrong'] as const) {
      expect(unpackAnswers(packAnswers([{ ...full, verdict }]))[0]?.verdict).toBe(verdict);
    }
  });

  it('is smaller than the objects it replaces, which is the only reason it exists', () => {
    const answers = Array.from({ length: 500 }, () => full);
    const packed = JSON.stringify(packAnswers(answers)).length;
    expect(packed).toBeLessThan(JSON.stringify(answers).length / 2);
  });

  it('reads an unknown verdict code as wrong rather than trusting it', () => {
    expect(unpackAnswers([['x', 99, 1000, 1]])[0]?.verdict).toBe('wrong');
  });

  it('scores the same after a round-trip, so the stored row is replayable', () => {
    const answers = [
      { ...full, verdict: 'correct' as const, acceptedOnRetry: false },
      { ...full, verdict: 'wrong' as const },
    ];
    expect(replaySession(unpackAnswers(packAnswers(answers)))).toEqual(replaySession(answers));
  });
});
