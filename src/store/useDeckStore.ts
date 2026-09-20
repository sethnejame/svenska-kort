import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { Deck } from '../types/progress';
import type { WordEntry } from '../types/word';
import { BUILTIN_DECKS, entriesForDeck } from '../data/decks';
import { getItem, removeItem, setItem } from './storage';

/**
 * Built-in decks are static imports and never live in state. This store exists
 * for what a learner adds themselves: their own entries, and (from T13) their
 * own decks.
 */
export interface DeckState {
  userEntries: WordEntry[];
  userDecks: Deck[];
  selectedDeckId: string | null;
}

export interface DeckActions {
  addEntry: (entry: WordEntry) => void;
  selectDeck: (deckId: string) => void;
}

export const DECK_STORAGE_KEY = 'svenska-kort:decks:v1';

export const INITIAL_DECK_STATE: DeckState = {
  userEntries: [],
  userDecks: [],
  selectedDeckId: null,
};

export const useDeckStore = create<DeckState & DeckActions>()(
  persist(
    (set) => ({
      ...INITIAL_DECK_STATE,

      addEntry: (entry) => {
        // The caller deduped the id against everything already known, so an
        // append is safe and keeps the newest word last in the deck.
        set((state) => ({ userEntries: [...state.userEntries, entry] }));
      },

      selectDeck: (deckId) => {
        set({ selectedDeckId: deckId });
      },
    }),
    {
      name: DECK_STORAGE_KEY,
      storage: createJSONStorage(() => ({ getItem, setItem, removeItem })),
      partialize: (state) => ({
        userEntries: state.userEntries,
        userDecks: state.userDecks,
        selectedDeckId: state.selectedDeckId,
      }),
    },
  ),
);

/** Built-in decks with their entry ids resolved, added words folded in. */
export function builtinDeckList(userEntries: readonly WordEntry[] = []): Deck[] {
  return BUILTIN_DECKS.map((deck) => ({
    id: deck.id,
    name: deck.name,
    description: deck.description,
    source: 'builtin' as const,
    entryIds: entriesForDeck(deck.id, userEntries).map((entry) => entry.id),
    createdAt: '',
  }));
}

export const BUILTIN_DECK_LIST: Deck[] = builtinDeckList();

/** Every deck the picker should show, built-ins first. */
export function allDecks(
  userDecks: readonly Deck[],
  userEntries: readonly WordEntry[] = [],
): Deck[] {
  return [...builtinDeckList(userEntries), ...userDecks];
}
