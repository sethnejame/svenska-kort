import { describe, expect, it } from 'vitest';
import { entryId, slug } from './entryId';

describe('slug', () => {
  it('folds the swedish letters rather than dropping them', () => {
    expect(slug('få')).toBe('fa');
    expect(slug('övergå')).toBe('overga');
  });

  it('joins words with a single hyphen', () => {
    expect(slug('  Det gör inget  ')).toBe('det-gor-inget');
  });

  it('collapses punctuation and never leaves a trailing hyphen', () => {
    expect(slug('Vad så?!')).toBe('vad-sa');
    expect(slug('—hej—')).toBe('hej');
  });

  it('comes back empty when nothing survives', () => {
    expect(slug('!!!')).toBe('');
  });
});

describe('entryId', () => {
  it('pairs the slug with the part of speech', () => {
    expect(entryId('regering', 'noun', new Set())).toBe('regering-noun');
  });

  it('separates the same word used as two parts of speech', () => {
    const taken = new Set(['lova-verb']);
    expect(entryId('lova', 'noun', taken)).toBe('lova-noun');
  });

  it('adds a suffix rather than shadowing an id already in use', () => {
    expect(entryId('ga', 'verb', new Set(['ga-verb']))).toBe('ga-verb-2');
  });

  it('keeps counting past a suffix that is also taken', () => {
    const taken = new Set(['ga-verb', 'ga-verb-2', 'ga-verb-3']);
    expect(entryId('ga', 'verb', taken)).toBe('ga-verb-4');
  });

  it('still produces an id when the slug is empty', () => {
    expect(entryId('???', 'other', new Set())).toBe('ord-other');
  });
});
