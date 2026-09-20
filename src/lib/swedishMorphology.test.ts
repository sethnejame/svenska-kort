import { describe, expect, it } from 'vitest';
import { suggestNounForms, suggestVerbForms } from './swedishMorphology';

describe('suggestVerbForms', () => {
  it('treats a regular -a verb as group 1 and says so with confidence', () => {
    const { suggestion, confidence } = suggestVerbForms('tala');

    expect(confidence).toBe('high');
    expect(suggestion).toEqual({
      kind: 'verb',
      infinitive: 'tala',
      present: 'talar',
      past: 'talade',
      supine: 'talat',
      imperative: 'tala',
      group: 1,
    });
  });

  it('takes -te after a voiceless stem, never -de', () => {
    const { suggestion } = suggestVerbForms('läsa');

    expect(suggestion).toMatchObject({ present: 'läser', past: 'läste', supine: 'läst' });
    expect(suggestion).not.toMatchObject({ past: 'läsde' });
  });

  it('keeps -de after a voiced stem', () => {
    expect(suggestVerbForms('ringa').suggestion).toMatchObject({
      present: 'ringer',
      past: 'ringde',
      supine: 'ringt',
      group: 2,
    });
  });

  it('never claims certainty about group 2, which is a lookup rather than a rule', () => {
    expect(suggestVerbForms('ringa').confidence).toBe('low');
  });

  it('lets n and m swallow the following d', () => {
    expect(suggestVerbForms('känna').suggestion).toMatchObject({ past: 'kände', supine: 'känt' });
    expect(suggestVerbForms('glömma').suggestion).toMatchObject({ past: 'glömde', supine: 'glömt' });
  });

  it('does not double the d of an -nd stem', () => {
    expect(suggestVerbForms('använda').suggestion).toMatchObject({
      past: 'använde',
      supine: 'använt',
    });
  });

  it('reads a short stressed vowel as group 3', () => {
    const { suggestion, confidence } = suggestVerbForms('bo');

    expect(confidence).toBe('high');
    expect(suggestion).toEqual({
      kind: 'verb',
      infinitive: 'bo',
      present: 'bor',
      past: 'bodde',
      supine: 'bott',
      imperative: 'bo',
      group: 3,
    });
  });

  it('declines to guess a strong verb rather than answering wrongly', () => {
    expect(suggestVerbForms('dricka')).toEqual({ suggestion: null, confidence: 'low' });
  });

  it('declines an infinitive that does not end in a vowel', () => {
    expect(suggestVerbForms('talar').suggestion).toBeNull();
  });

  it('declines anything that is not a lowercase swedish word', () => {
    expect(suggestVerbForms('  ').suggestion).toBeNull();
    expect(suggestVerbForms('a').suggestion).toBeNull();
    expect(suggestVerbForms('to talk').suggestion).toBeNull();
  });

  it('tidies the input before reading it', () => {
    expect(suggestVerbForms('  Tala  ').suggestion).toMatchObject({ infinitive: 'tala' });
  });
});

describe('suggestNounForms', () => {
  it('gives an en word the -en / -ar / -arna pattern', () => {
    const { suggestion, confidence } = suggestNounForms('tidning', 'en');

    expect(confidence).toBe('high');
    expect(suggestion).toEqual({
      kind: 'noun',
      gender: 'en',
      indefSg: 'tidning',
      defSg: 'tidningen',
      indefPl: 'tidningar',
      defPl: 'tidningarna',
    });
  });

  it('leaves an ett plural bare', () => {
    expect(suggestNounForms('hus', 'ett').suggestion).toEqual({
      kind: 'noun',
      gender: 'ett',
      indefSg: 'hus',
      defSg: 'huset',
      indefPl: 'hus',
      defPl: 'husen',
    });
  });

  it('declines a noun ending in a vowel, where the pattern splits', () => {
    expect(suggestNounForms('flicka', 'en').suggestion).toBeNull();
    expect(suggestNounForms('äpple', 'ett').suggestion).toBeNull();
  });

  it('declines anything that is not a lowercase swedish word', () => {
    expect(suggestNounForms('', 'en').suggestion).toBeNull();
    expect(suggestNounForms('en tidning', 'en').suggestion).toBeNull();
  });

  it('tidies the input before reading it', () => {
    expect(suggestNounForms(' Hus ', 'ett').suggestion).toMatchObject({ indefSg: 'hus' });
  });
});
