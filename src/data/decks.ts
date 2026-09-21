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
  { id: 'siffror', name: 'Siffror', description: 'Numbers, counting, and amounts', tag: 'siffror' },
  { id: 'farger', name: 'Färger', description: 'Colours and their inflections', tag: 'farger' },
  { id: 'tid', name: 'Tid', description: 'Days, months, seasons, and telling time', tag: 'tid' },
  { id: 'mat', name: 'Mat och dryck', description: 'Food, drink, and cooking', tag: 'mat' },
  { id: 'familj', name: 'Familj och personer', description: 'Family and people', tag: 'familj' },
  { id: 'kropp', name: 'Kroppen', description: 'The body and how it feels', tag: 'kropp' },
  { id: 'klader', name: 'Kläder', description: 'Clothes and what you wear', tag: 'klader' },
  { id: 'hem', name: 'Hemma', description: 'The home, rooms, and chores', tag: 'hem' },
  { id: 'djur', name: 'Djur', description: 'Animals, tame and wild', tag: 'djur' },
  { id: 'natur', name: 'Natur och väder', description: 'Nature, weather, and the outdoors', tag: 'natur' },
  { id: 'stad', name: 'I staden', description: 'Shops, streets, and getting around town', tag: 'stad' },
  { id: 'resa', name: 'Resa', description: 'Travel, transport, and directions', tag: 'resa' },
  { id: 'jobb', name: 'Jobb', description: 'Work, money, and professions', tag: 'jobb' },
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
