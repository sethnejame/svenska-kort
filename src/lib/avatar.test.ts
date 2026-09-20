import { describe, expect, it } from 'vitest';
import {
  avatarLook,
  EYE_COUNT,
  hashSeed,
  MOUTH_COUNT,
  randomSeed,
  randomSeeds,
  SHAPE_COUNT,
} from './avatar';

describe('hashSeed', () => {
  it('is stable for the same string', () => {
    expect(hashSeed('bulle')).toBe(hashSeed('bulle'));
  });

  it('separates strings that differ by one character', () => {
    expect(hashSeed('bulle')).not.toBe(hashSeed('bullf'));
  });

  it('hashes the empty string to the FNV offset basis', () => {
    expect(hashSeed('')).toBe(0x811c9dc5);
  });
});

describe('avatarLook', () => {
  it('returns the identical look for the identical seed', () => {
    expect(avatarLook('kanelbulle')).toEqual(avatarLook('kanelbulle'));
  });

  it('keeps every feature inside its range', () => {
    for (const seed of ['a', 'b', 'lingon', 'r2d2', '', 'ÅÄÖ']) {
      const look = avatarLook(seed);
      expect(look.hue, seed).toBeGreaterThanOrEqual(0);
      expect(look.hue, seed).toBeLessThan(360);
      expect(look.shape, seed).toBeLessThan(SHAPE_COUNT);
      expect(look.eyes, seed).toBeLessThan(EYE_COUNT);
      expect(look.mouth, seed).toBeLessThan(MOUTH_COUNT);
    }
  });

  it('gives different seeds different looks', () => {
    const looks = new Set(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => JSON.stringify(avatarLook(seed))),
    );
    expect(looks.size).toBeGreaterThan(1);
  });
});

describe('randomSeed', () => {
  it('draws eight characters from the alphabet', () => {
    expect(randomSeed(() => 0)).toBe('aaaaaaaa');
    expect(randomSeed(() => 0.5)).toMatch(/^[a-z0-9]{8}$/);
  });

  it('is driven entirely by the rng it is handed', () => {
    const values = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const draw = () => {
      let index = 0;
      return () => values[index++ % values.length] ?? 0;
    };
    expect(randomSeed(draw())).toBe(randomSeed(draw()));
  });

  it('survives an rng that returns its exclusive upper bound', () => {
    // `Math.random` never returns 1, but a seeded stand-in might.
    expect(randomSeed(() => 1)).toBe('');
  });

  it('builds a batch of seeds to choose between', () => {
    let step = 0;
    const seeds = randomSeeds(6, () => {
      step += 1;
      return (step % 36) / 36;
    });
    expect(seeds).toHaveLength(6);
    expect(new Set(seeds).size).toBe(6);
  });
});
