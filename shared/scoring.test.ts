import { describe, expect, it } from 'vitest';
import { multiplier, pointsFor } from './scoring';

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
