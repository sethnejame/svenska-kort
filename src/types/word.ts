export type PartOfSpeech =
  | 'noun'
  | 'verb'
  | 'adjective'
  | 'adverb'
  | 'pronoun'
  | 'preposition'
  | 'conjunction'
  | 'numeral'
  | 'phrase'
  | 'other';

export interface WordEntry {
  id: string; // stable slug, e.g. "regering-noun"
  swedish: string; // what shows on the front of the card
  lemma?: string; // dictionary form, when `swedish` is inflected
  english: string[]; // accepted answers, most canonical first
  pos: PartOfSpeech;
  forms?: WordForms; // rendered as a table on the card back
  example?: {
    // one short sentence in context
    sv: string;
    en: string;
  };
  note?: string; // register/usage, e.g. "easier than 'tycker om'"
  tags?: string[]; // "news", "school", "sfi-d"
  level?: 1 | 2 | 3; // 1 core, 3 advanced
}

// Discriminated by part of speech so the card back renders the right table.
export type WordForms =
  | {
      kind: 'noun';
      gender: 'en' | 'ett';
      indefSg: string;
      defSg: string;
      indefPl: string;
      defPl: string;
    }
  | {
      kind: 'verb';
      infinitive: string;
      present: string;
      past: string;
      supine: string;
      imperative?: string;
      group?: 1 | 2 | 3 | 4;
    }
  | {
      kind: 'adjective';
      base: string;
      neuter: string;
      plural: string;
      comparative?: string;
      superlative?: string;
    }
  | { kind: 'none' };
