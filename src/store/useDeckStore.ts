import { create } from 'zustand';
import type { Deck } from '../types/progress';
import { BUILTIN_DECKS, entriesForDeck } from '../data/decks';

/**
 * Built-in decks are static imports and never live in state. This store exists
 * for the decks a learner adds themselves, which T13 starts writing.
 */
export interface DeckState {
  userDecks: Deck[];
  selectedDeckId: string | null;
}

export interface DeckActions {
  selectDeck: (deckId: string) => void;
}

export const BUILTIN_DECK_LIST: Deck[] = BUILTIN_DECKS.map((deck) => ({
  id: deck.id,
  name: deck.name,
  description: deck.description,
  source: 'builtin',
  entryIds: entriesForDeck(deck.id).map((entry) => entry.id),
  createdAt: '',
}));

export const useDeckStore = create<DeckState & DeckActions>()((set) => ({
  userDecks: [],
  selectedDeckId: null,
  selectDeck: (deckId) => {
    set({ selectedDeckId: deckId });
  },
}));

/** Every deck the picker should show, built-ins first. */
export function allDecks(userDecks: readonly Deck[]): Deck[] {
  return [...BUILTIN_DECK_LIST, ...userDecks];
}
