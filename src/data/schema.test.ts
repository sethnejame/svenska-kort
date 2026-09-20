import { describe, expect, it } from 'vitest';
import { wordEntrySchema, entriesFileSchema } from './schema';

const validNoun = {
  id: 'regering-noun',
  swedish: 'regeringen',
  lemma: 'regering',
  english: ['the government'],
  pos: 'noun',
  forms: {
    kind: 'noun',
    gender: 'en',
    indefSg: 'en regering',
    defSg: 'regeringen',
    indefPl: 'regeringar',
    defPl: 'regeringarna',
  },
};

describe('wordEntrySchema', () => {
  it('accepts a complete noun entry', () => {
    expect(wordEntrySchema.safeParse(validNoun).success).toBe(true);
  });

  it('rejects a noun with no gender', () => {
    const { gender: _gender, ...formsWithoutGender } = validNoun.forms;
    const result = wordEntrySchema.safeParse({ ...validNoun, forms: formsWithoutGender });
    expect(result.success).toBe(false);
  });

  it('rejects an id containing non-slug characters', () => {
    expect(wordEntrySchema.safeParse({ ...validNoun, id: 'regeringen-å' }).success).toBe(false);
  });

  it('rejects an empty english list', () => {
    expect(wordEntrySchema.safeParse({ ...validNoun, english: [] }).success).toBe(false);
  });

  it('rejects a verb missing its supine', () => {
    const result = wordEntrySchema.safeParse({
      id: 'minska-verb',
      swedish: 'minskade',
      english: ['decreased'],
      pos: 'verb',
      forms: { kind: 'verb', infinitive: 'minska', present: 'minskar', past: 'minskade' },
    });
    expect(result.success).toBe(false);
  });

  it("requires pos 'phrase' to pair with forms.kind 'none'", () => {
    const base = {
      id: 'fast-jag-tycker-phrase',
      swedish: 'fast jag tycker',
      english: ['although I think'],
      pos: 'phrase',
    };
    expect(wordEntrySchema.safeParse({ ...base, forms: { kind: 'none' } }).success).toBe(true);
    expect(wordEntrySchema.safeParse(base).success).toBe(false);
  });

  it('parses a file of entries', () => {
    expect(entriesFileSchema.safeParse([validNoun]).success).toBe(true);
  });
});
