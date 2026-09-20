import { beforeEach, describe, expect, it } from 'vitest';
import type { Deck } from '../types/progress';
import type { WordEntry } from '../types/word';
import { allDecks, BUILTIN_DECK_LIST, INITIAL_DECK_STATE, useDeckStore } from './useDeckStore';

const userDeck: Deck = {
  id: 'mina-ord',
  name: 'Mina ord',
  description: 'Words I added',
  source: 'user',
  entryIds: ['a', 'b'],
  createdAt: '2026-09-20T00:00:00.000Z',
};

const added: WordEntry = {
  id: 'kylskap-noun',
  swedish: 'kylskåp',
  english: ['fridge'],
  pos: 'noun',
  tags: ['everyday'],
};

describe('useDeckStore', () => {
  beforeEach(() => {
    useDeckStore.setState({ ...INITIAL_DECK_STATE });
  });

  it('resolves every builtin deck to its entry ids up front', () => {
    expect(BUILTIN_DECK_LIST).toHaveLength(6);

    const alla = BUILTIN_DECK_LIST.find((deck) => deck.id === 'alla');
    expect(alla?.entryIds).toHaveLength(72);
    expect(alla?.source).toBe('builtin');
  });

  it('starts with no user decks, no added words and nothing selected', () => {
    const state = useDeckStore.getState();
    expect(state.userDecks).toEqual([]);
    expect(state.userEntries).toEqual([]);
    expect(state.selectedDeckId).toBeNull();
  });

  it('remembers the deck the learner tapped', () => {
    useDeckStore.getState().selectDeck('fraser');
    expect(useDeckStore.getState().selectedDeckId).toBe('fraser');
  });

  it('keeps added words in the order they were written', () => {
    const second: WordEntry = { ...added, id: 'spis-noun', swedish: 'spis' };
    useDeckStore.getState().addEntry(added);
    useDeckStore.getState().addEntry(second);

    expect(useDeckStore.getState().userEntries.map((entry) => entry.id)).toEqual([
      'kylskap-noun',
      'spis-noun',
    ]);
  });

  it('lists builtin decks before the learner’s own', () => {
    const decks = allDecks([userDeck]);
    expect(decks).toHaveLength(7);
    expect(decks.at(-1)).toBe(userDeck);
  });

  it('folds an added word into alla and into the deck its tag names', () => {
    const decks = allDecks([], [added]);

    const alla = decks.find((deck) => deck.id === 'alla');
    const vardag = decks.find((deck) => deck.id === 'vardag');
    const skola = decks.find((deck) => deck.id === 'skola');

    expect(alla?.entryIds).toContain('kylskap-noun');
    expect(vardag?.entryIds).toContain('kylskap-noun');
    expect(skola?.entryIds).not.toContain('kylskap-noun');
  });

  it('leaves an untagged word in alla only', () => {
    const untagged: WordEntry = { id: 'x-other', swedish: 'x', english: ['x'], pos: 'other' };
    const decks = allDecks([], [untagged]);

    expect(decks.find((deck) => deck.id === 'alla')?.entryIds).toContain('x-other');
    expect(decks.find((deck) => deck.id === 'vardag')?.entryIds).not.toContain('x-other');
  });
});
