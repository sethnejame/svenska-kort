import { describe, expect, it } from 'vitest';
import { ALL_ENTRIES, BUILTIN_DECKS, entriesForDeck, getDeck, getEntry } from './decks';
import { entriesFileSchema } from './schema';

describe('seed entries', () => {
  it('ships 71 entries that satisfy the schema', () => {
    expect(ALL_ENTRIES).toHaveLength(71);
    expect(entriesFileSchema.safeParse(ALL_ENTRIES).success).toBe(true);
  });

  it('gives every noun a gender and all four forms', () => {
    for (const entry of ALL_ENTRIES.filter((e) => e.pos === 'noun')) {
      expect(entry.forms?.kind, entry.id).toBe('noun');
      if (entry.forms?.kind !== 'noun') continue;
      expect(entry.forms.gender, entry.id).toMatch(/^(en|ett)$/);
      expect(entry.forms.indefSg, entry.id).not.toBe('');
      expect(entry.forms.defSg, entry.id).not.toBe('');
      expect(entry.forms.indefPl, entry.id).not.toBe('');
      expect(entry.forms.defPl, entry.id).not.toBe('');
    }
  });

  it('gives every verb a supine', () => {
    for (const entry of ALL_ENTRIES.filter((e) => e.pos === 'verb')) {
      expect(entry.forms?.kind, entry.id).toBe('verb');
      if (entry.forms?.kind !== 'verb') continue;
      expect(entry.forms.supine, entry.id).not.toBe('');
    }
  });

  // `färre` is an indeclinable comparative, so 'none' is correct data rather than a gap.
  it('gives every declinable adjective base, neuter and plural', () => {
    for (const entry of ALL_ENTRIES.filter((e) => e.pos === 'adjective')) {
      expect(entry.forms?.kind, entry.id).toMatch(/^(adjective|none)$/);
      if (entry.forms?.kind !== 'adjective') continue;
      expect(entry.forms.base, entry.id).not.toBe('');
      expect(entry.forms.neuter, entry.id).not.toBe('');
      expect(entry.forms.plural, entry.id).not.toBe('');
    }
  });

  it('pairs every phrase with forms.kind none', () => {
    for (const entry of ALL_ENTRIES.filter((e) => e.pos === 'phrase')) {
      expect(entry.forms?.kind, entry.id).toBe('none');
    }
  });

  it('has unique ids', () => {
    expect(new Set(ALL_ENTRIES.map((e) => e.id)).size).toBe(ALL_ENTRIES.length);
  });
});

describe('entriesForDeck', () => {
  it.each([
    ['nyheter', 40],
    ['vardag', 24],
    ['verb', 21],
    ['skola', 15],
    ['fraser', 6],
    ['alla', 71],
  ])('%s holds %i entries', (deckId, count) => {
    expect(entriesForDeck(deckId)).toHaveLength(count);
  });

  it('returns nothing for an unknown deck', () => {
    expect(entriesForDeck('inte-en-lek')).toEqual([]);
  });

  it('lets a word appear in more than one deck without duplicating it', () => {
    const hande = getEntry('handa-verb');
    expect(hande?.tags).toEqual(expect.arrayContaining(['everyday', 'news', 'verb']));
    expect(entriesForDeck('vardag')).toContain(hande);
    expect(entriesForDeck('verb')).toContain(hande);
  });
});

describe('lookups', () => {
  it('finds an entry by id and misses cleanly', () => {
    expect(getEntry('regering-noun')?.swedish).toBe('regeringen');
    expect(getEntry('inte-ett-ord')).toBeUndefined();
  });

  it('finds a deck by id and misses cleanly', () => {
    expect(getDeck('fraser')?.name).toBe('Fraser');
    expect(getDeck('ingen-lek')).toBeUndefined();
  });

  it('resolves every builtin deck tag against real entries', () => {
    const tags = new Set(ALL_ENTRIES.flatMap((e) => e.tags ?? []));
    for (const deck of BUILTIN_DECKS) {
      if (deck.tag !== null) expect(tags.has(deck.tag), deck.id).toBe(true);
    }
  });
});
