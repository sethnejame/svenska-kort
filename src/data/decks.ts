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

export function getEntry(id: string): WordEntry | undefined {
  return byId.get(id);
}

export function getDeck(deckId: string): BuiltinDeck | undefined {
  return BUILTIN_DECKS.find((deck) => deck.id === deckId);
}

export function entriesForDeck(deckId: string): WordEntry[] {
  const deck = getDeck(deckId);
  if (!deck) return [];
  if (deck.tag === null) return [...ALL_ENTRIES];
  return ALL_ENTRIES.filter((entry) => entry.tags?.includes(deck.tag) ?? false);
}
