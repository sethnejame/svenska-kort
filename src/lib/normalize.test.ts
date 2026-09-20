import { describe, expect, it } from 'vitest';
import { alternates, normalize } from './normalize';

describe('normalize', () => {
  it('trims, collapses whitespace and lowercases', () => {
    expect(normalize('  The   Government  ')).toBe('government');
  });

  it('strips surrounding quotes', () => {
    expect(normalize('"comrade"')).toBe('comrade');
    expect(normalize("'comrade'")).toBe('comrade');
    expect(normalize('\u201ccomrade\u201d')).toBe('comrade');
  });

  it('strips trailing punctuation', () => {
    expect(normalize('fewer.')).toBe('fewer');
    expect(normalize('really!')).toBe('really');
    expect(normalize('what?')).toBe('what');
  });

  it('drops one leading article', () => {
    expect(normalize('the number')).toBe('number');
    expect(normalize('to know a language')).toBe('know a language');
    expect(normalize('a grej')).toBe('grej');
    expect(normalize('an object')).toBe('object');
  });

  it('strips parentheticals and the whitespace they leave', () => {
    expect(normalize('like (easier)')).toBe('like');
    expect(normalize('(the) government')).toBe('government');
    expect(normalize('the (whole) government')).toBe('government');
  });

  it('leaves diacritics alone', () => {
    expect(normalize('  Förälder ')).toBe('förälder');
  });

  it('returns an empty string for empty or punctuation-only input', () => {
    expect(normalize('')).toBe('');
    expect(normalize('   ')).toBe('');
    expect(normalize('(everything)')).toBe('');
  });

  it('keeps a bare article as a word rather than emptying it', () => {
    expect(normalize('the ')).toBe('the');
  });
});

describe('alternates', () => {
  it('splits on slashes and commas', () => {
    expect(alternates('number / the number')).toEqual(['number', 'number']);
    expect(alternates('likes, like')).toEqual(['likes', 'like']);
  });

  it('drops empty pieces', () => {
    expect(alternates('likes,,')).toEqual(['likes']);
  });
});
