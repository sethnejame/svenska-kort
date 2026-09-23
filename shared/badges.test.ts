import { describe, expect, it } from 'vitest';
import {
  ALL_DECK_TOPIC_IDS,
  BADGE_IDS,
  BADGE_META,
  hasAllDecks,
  hasHundredWords,
  hasWeekWarrior,
  isFirstSession,
  isPerfectDeck,
  isSpeedDemon,
  isStreak10,
  isStreak25,
} from './badges';

describe('BADGE_IDS / BADGE_META', () => {
  it('has Swedish copy for every badge, and only those badges', () => {
    expect(BADGE_META !== null).toBe(true);
    for (const id of BADGE_IDS) {
      expect(BADGE_META[id].name.length).toBeGreaterThan(0);
      expect(BADGE_META[id].condition.length).toBeGreaterThan(0);
    }
    expect(Object.keys(BADGE_META).sort()).toEqual([...BADGE_IDS].sort());
  });
});

describe('isFirstSession', () => {
  it('mirrors the boolean it is handed', () => {
    expect(isFirstSession(true)).toBe(true);
    expect(isFirstSession(false)).toBe(false);
  });
});

describe('isStreak10 / isStreak25', () => {
  it('fires at the threshold, not before', () => {
    expect(isStreak10(9)).toBe(false);
    expect(isStreak10(10)).toBe(true);
    expect(isStreak10(11)).toBe(true);
    expect(isStreak25(24)).toBe(false);
    expect(isStreak25(25)).toBe(true);
  });
});

describe('isPerfectDeck', () => {
  it('needs at least ten answers, and all of them correct', () => {
    expect(isPerfectDeck(9, 9)).toBe(false);
    expect(isPerfectDeck(10, 9)).toBe(false);
    expect(isPerfectDeck(10, 10)).toBe(true);
    expect(isPerfectDeck(15, 10)).toBe(false);
  });
});

describe('isSpeedDemon', () => {
  const fast = { verdict: 'correct', wasTyped: true, elapsedMs: 3999 };
  const slow = { verdict: 'correct', wasTyped: true, elapsedMs: 4001 };
  const peeked = { verdict: 'correct', wasTyped: false, elapsedMs: 100 };
  const wrong = { verdict: 'wrong', wasTyped: true, elapsedMs: 100 };

  it('needs ten fast, typed, correct answers', () => {
    expect(isSpeedDemon(Array.from({ length: 9 }, () => fast))).toBe(false);
    expect(isSpeedDemon(Array.from({ length: 10 }, () => fast))).toBe(true);
  });

  it('does not count slow, peeked, or wrong answers', () => {
    const mixed = [
      ...Array.from({ length: 10 }, () => slow),
      ...Array.from({ length: 10 }, () => peeked),
      ...Array.from({ length: 10 }, () => wrong),
    ];
    expect(isSpeedDemon(mixed)).toBe(false);
  });
});

describe('hasWeekWarrior', () => {
  it('needs five distinct days', () => {
    expect(hasWeekWarrior(4)).toBe(false);
    expect(hasWeekWarrior(5)).toBe(true);
  });
});

describe('hasAllDecks', () => {
  it('needs every topic deck played', () => {
    expect(hasAllDecks(ALL_DECK_TOPIC_IDS.slice(0, -1))).toBe(false);
    expect(hasAllDecks([...ALL_DECK_TOPIC_IDS])).toBe(true);
  });
});

describe('hasHundredWords', () => {
  it('needs a hundred distinct correct entries', () => {
    expect(hasHundredWords(99)).toBe(false);
    expect(hasHundredWords(100)).toBe(true);
  });
});
