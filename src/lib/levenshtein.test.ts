import { describe, expect, it } from 'vitest';
import { levenshtein } from './levenshtein';

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('decreased', 'decreased')).toBe(0);
  });

  it('falls back to length when one side is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', '')).toBe(0);
  });

  it('counts a single substitution, insertion and deletion as one', () => {
    expect(levenshtein('decresed', 'decreased')).toBe(1);
    expect(levenshtein('cat', 'cats')).toBe(1);
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('counts two edits as two', () => {
    expect(levenshtein('decrised', 'decreased')).toBe(2);
    expect(levenshtein('increased', 'decreased')).toBe(2);
  });

  it('is symmetric', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('sitting', 'kitten')).toBe(3);
  });
});
