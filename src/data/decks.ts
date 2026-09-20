import type { WordEntry } from '../types/word';
import entriesJson from './entries.json';

export const ALL_ENTRIES = entriesJson as WordEntry[];

export const BUILTIN_DECKS = [
  {
    id: 'nyheter',
    name: 'Nyheter och samhälle',
    description: 'News, politics, and civic life',
    tag: 'news',
  },
  { id: 'skola', name: 'Skola och språk', description: 'School, study, and language', tag: 'school' },
  { id: 'vardag', name: 'Vardag', description: 'Everyday words and fillers', tag: 'everyday' },
  { id: 'fraser', name: 'Fraser', description: 'Phrases as you meet them', tag: 'phrase' },
  { id: 'verb', name: 'Verb i text', description: 'Verbs in the forms you read', tag: 'verb' },
  { id: 'alla', name: 'Alla ord', description: 'The whole deck', tag: null },
] as const;

export type BuiltinDeck = (typeof BUILTIN_DECKS)[number];
export type BuiltinDeckId = BuiltinDeck['id'];

const byId = new Map(ALL_ENTRIES.map((entry) => [entry.id, entry]));

/**
 * `userEntries` is whatever the learner has added. It is passed in rather than
 * imported so this module stays a plain data module with no store dependency.
 */
export function getEntry(id: string, userEntries: readonly WordEntry[] = []): WordEntry | undefined {
  return byId.get(id) ?? userEntries.find((entry) => entry.id === id);
}

export function getDeck(deckId: string): BuiltinDeck | undefined {
  return BUILTIN_DECKS.find((deck) => deck.id === deckId);
}

export function entriesForDeck(deckId: string, userEntries: readonly WordEntry[] = []): WordEntry[] {
  const deck = getDeck(deckId);
  if (!deck) return [];

  const tag = deck.tag;
  // `alla` has no tag and takes everything, including every added word.
  if (tag === null) return [...ALL_ENTRIES, ...userEntries];

  const matches = (entry: WordEntry) => entry.tags?.includes(tag) ?? false;
  return [...ALL_ENTRIES.filter(matches), ...userEntries.filter(matches)];
}
