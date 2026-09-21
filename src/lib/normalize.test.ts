import { describe, expect, it } from 'vitest';
import { alternates, foldSwedish, normalize, normalizeSwedish } from './normalize';

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

describe('normalizeSwedish', () => {
  it('tidies case, spacing and a trailing question mark', () => {
    expect(normalizeSwedish('  Hur Mår   Du?  ')).toBe('hur mår du');
  });

  it('leaves the article where it is', () => {
    // `en` and `ett` carry the gender, and `att` is part of the infinitive, so
    // dropping either would throw away the thing being learnt.
    expect(normalizeSwedish('en bil')).toBe('en bil');
    expect(normalizeSwedish('att begrava')).toBe('att begrava');
  });

  it('keeps every Swedish letter intact', () => {
    expect(normalizeSwedish('Språket')).toBe('språket');
  });
});

describe('foldSwedish', () => {
  it('flattens the three Swedish vowels onto keys every keyboard has', () => {
    expect(foldSwedish('åäö')).toBe('aao');
    expect(foldSwedish('språket')).toBe('spraket');
  });

  it('flattens an acute accent too', () => {
    expect(foldSwedish('idé')).toBe('ide');
  });

  it('leaves a word with nothing to fold alone', () => {
    expect(foldSwedish('hus')).toBe('hus');
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
