import { describe, expect, it } from 'vitest';
import {
  ALL_ENTRIES,
  BUILTIN_DECKS,
  deckDisplayName,
  entriesForDeck,
  getDeck,
  getEntry,
  WEAKEST_DECK,
} from './decks';
import { entriesFileSchema } from './schema';

describe('seed entries', () => {
  it('ships a full deck of entries that satisfy the schema', () => {
    // A floor rather than an exact count: vocabulary is added over time and a
    // frozen number would fail on every addition without catching a real bug.
    expect(ALL_ENTRIES.length).toBeGreaterThanOrEqual(600);
    expect(entriesFileSchema.safeParse(ALL_ENTRIES).success).toBe(true);
  });

  // Month names are tagged as nouns but carry 'none': "mars" has no article and
  // no plural in use, so an inflection table would be inventing forms.
  it('gives every declinable noun a gender and all four forms', () => {
    for (const entry of ALL_ENTRIES.filter((e) => e.pos === 'noun')) {
      expect(entry.forms?.kind, entry.id).toMatch(/^(noun|none)$/);
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
  it.each(BUILTIN_DECKS.map((deck) => [deck.id, deck.tag] as const))(
    '%s holds exactly the entries carrying its tag',
    (deckId, tag) => {
      const expected =
        tag === null ? ALL_ENTRIES : ALL_ENTRIES.filter((e) => e.tags?.includes(tag));
      expect(entriesForDeck(deckId)).toEqual(expected);
      // A deck nobody can play is a data bug, so the floor is part of the assertion.
      expect(expected.length, deckId).toBeGreaterThan(0);
    },
  );

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

  it('names the generated deck, which no tag would find', () => {
    expect(getDeck(WEAKEST_DECK.id)).toBeUndefined();
    expect(entriesForDeck(WEAKEST_DECK.id)).toEqual([]);
    expect(deckDisplayName(WEAKEST_DECK.id)).toBe('Svagast');
  });

  it('names a builtin deck and falls back to the id it was given', () => {
    expect(deckDisplayName('fraser')).toBe('Fraser');
    expect(deckDisplayName('ingen-lek')).toBe('ingen-lek');
  });

  it('resolves every builtin deck tag against real entries', () => {
    const tags = new Set(ALL_ENTRIES.flatMap((e) => e.tags ?? []));
    for (const deck of BUILTIN_DECKS) {
      if (deck.tag !== null) expect(tags.has(deck.tag), deck.id).toBe(true);
    }
  });
});
