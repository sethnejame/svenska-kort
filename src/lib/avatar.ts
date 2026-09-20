/**
 * Deterministic avatars. A seed string hashes to a small set of drawing
 * choices, so the same seed always produces the same face — no avatar package,
 * no network request, nothing to load.
 */

export const SHAPE_COUNT = 4;
export const EYE_COUNT = 4;
export const MOUTH_COUNT = 3;

export interface AvatarLook {
  /** Degrees on the colour wheel. The one generated colour in the app. */
  hue: number;
  shape: number;
  eyes: number;
  mouth: number;
}

/** FNV-1a, 32 bit. Small, dependency-free, and stable across platforms. */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Each feature reads a different slice of the hash so they vary independently. */
export function avatarLook(seed: string): AvatarLook {
  const hash = hashSeed(seed);
  return {
    hue: hash % 360,
    shape: (hash >>> 9) % SHAPE_COUNT,
    eyes: (hash >>> 15) % EYE_COUNT,
    mouth: (hash >>> 21) % MOUTH_COUNT,
  };
}

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SEED_LENGTH = 8;

/** `rng` is an argument because nothing in `src/lib/` reaches for randomness itself. */
export function randomSeed(rng: () => number): string {
  let seed = '';
  for (let index = 0; index < SEED_LENGTH; index += 1) {
    seed += ALPHABET.charAt(Math.floor(rng() * ALPHABET.length));
  }
  return seed;
}

export function randomSeeds(count: number, rng: () => number): string[] {
  return Array.from({ length: count }, () => randomSeed(rng));
}
