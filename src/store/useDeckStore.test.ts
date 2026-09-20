import { describe, expect, it } from 'vitest';
import type { Deck } from '../types/progress';
import { allDecks, BUILTIN_DECK_LIST, useDeckStore } from './useDeckStore';

const userDeck: Deck = {
  id: 'mina-ord',
  name: 'Mina ord',
  description: 'Words I added',
  source: 'user',
  entryIds: ['a', 'b'],
  createdAt: '2026-09-20T00:00:00.000Z',
};

describe('useDeckStore', () => {
  it('resolves every builtin deck to its entry ids up front', () => {
    expect(BUILTIN_DECK_LIST).toHaveLength(6);

    const alla = BUILTIN_DECK_LIST.find((deck) => deck.id === 'alla');
    expect(alla?.entryIds).toHaveLength(72);
    expect(alla?.source).toBe('builtin');
  });

  it('starts with no user decks and nothing selected', () => {
    const state = useDeckStore.getState();
    expect(state.userDecks).toEqual([]);
    expect(state.selectedDeckId).toBeNull();
  });

  it('remembers the deck the learner tapped', () => {
    useDeckStore.getState().selectDeck('fraser');
    expect(useDeckStore.getState().selectedDeckId).toBe('fraser');
  });

  it('lists builtin decks before the learner’s own', () => {
    const decks = allDecks([userDeck]);
    expect(decks).toHaveLength(7);
    expect(decks.at(-1)).toBe(userDeck);
  });
});
