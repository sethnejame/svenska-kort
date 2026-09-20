import type { WordForms } from '../types/word';

/**
 * Paradigm guesses for the add form. Every suggestion is editable — this is a
 * time-saver, never an authority, which is what `confidence` is for.
 *
 * Swedish spelling does not separate group 1 from group 2: `tala` and `läsa`
 * look identical and conjugate differently. So group 1 is the structural
 * default and group 2 is a curated list of common verbs. A verb that is not
 * on the list and is not group 1 comes back as `null` rather than as a
 * confident wrong answer.
 */

export type Confidence = 'high' | 'low';

export interface FormsSuggestion {
  suggestion: WordForms | null;
  confidence: Confidence;
}

const VOWELS = 'aeiouyåäö';
const VOICELESS = 'kpstx';

const UNKNOWN: FormsSuggestion = { suggestion: null, confidence: 'low' };

/** Strong and irregular verbs. No rule predicts these, so none is offered. */
const STRONG_VERBS = new Set([
  'be', 'bita', 'bjuda', 'binda', 'bli', 'brinna', 'bryta', 'bära', 'dra', 'dricka', 'driva',
  'dyka', 'dö', 'falla', 'finna', 'flyga', 'frysa', 'få', 'försvinna', 'ge', 'gripa', 'gråta',
  'gå', 'göra', 'ha', 'heta', 'hinna', 'hugga', 'hålla', 'komma', 'ligga', 'ljuga', 'låta',
  'lägga', 'njuta', 'rida', 'se', 'sitta', 'sjunga', 'sjunka', 'skina', 'skjuta', 'skriva',
  'skära', 'slå', 'smyga', 'sova', 'springa', 'stiga', 'stjäla', 'stå', 'svära', 'säga', 'sätta',
  'ta', 'tvinga', 'vara', 'veta', 'vika', 'vinna', 'välja', 'äta',
]);

/** Group 2 verbs, which spelling alone cannot pick out from group 1. */
const GROUP_2_VERBS = new Set([
  'använda', 'behöva', 'bränna', 'bygga', 'byta', 'fylla', 'följa', 'föra', 'glömma', 'gömma',
  'hjälpa', 'hyra', 'hända', 'höra', 'känna', 'köpa', 'köra', 'leka', 'leva', 'lysa', 'lära',
  'läsa', 'möta', 'resa', 'ringa', 'räcka', 'röka', 'sända', 'steka', 'störa', 'stänga', 'ställa',
  'svänga', 'söka', 'tycka', 'tända', 'tänka', 'tömma', 'vända', 'åka',
]);

function verbForms(
  infinitive: string,
  present: string,
  past: string,
  supine: string,
  imperative: string,
  group: 1 | 2 | 3,
): WordForms {
  return { kind: 'verb', infinitive, present, past, supine, imperative, group };
}

/** n and m swallow the following d: `känna → kände`, `glömma → glömde`. */
function group2Past(stem: string): string {
  if (VOICELESS.includes(stem.slice(-1))) return `${stem}te`;
  if (stem.endsWith('nn') || stem.endsWith('mm')) return `${stem.slice(0, -1)}de`;
  if (stem.endsWith('nd')) return `${stem}e`;
  return `${stem}de`;
}

function group2Supine(stem: string): string {
  if (stem.endsWith('nn') || stem.endsWith('mm') || stem.endsWith('nd')) {
    return `${stem.slice(0, -1)}t`;
  }
  return `${stem}t`;
}

export function suggestVerbForms(input: string): FormsSuggestion {
  const infinitive = input.trim().toLowerCase();
  if (!/^[a-zåäö]{2,}$/.test(infinitive)) return UNKNOWN;
  if (STRONG_VERBS.has(infinitive)) return UNKNOWN;

  const last = infinitive.slice(-1);
  if (!VOWELS.includes(last)) return UNKNOWN;

  // Group 3: a short stem ending in a stressed vowel. `bo → bor, bodde, bott`.
  if (last !== 'a') {
    return {
      suggestion: verbForms(
        infinitive,
        `${infinitive}r`,
        `${infinitive}dde`,
        `${infinitive}tt`,
        infinitive,
        3,
      ),
      confidence: 'high',
    };
  }

  const stem = infinitive.slice(0, -1);

  if (GROUP_2_VERBS.has(infinitive)) {
    return {
      suggestion: verbForms(
        infinitive,
        `${stem}er`,
        group2Past(stem),
        group2Supine(stem),
        stem,
        2,
      ),
      // Group 2 is a lookup, not a rule, so it never claims to be certain.
      confidence: 'low',
    };
  }

  return {
    suggestion: verbForms(
      infinitive,
      `${infinitive}r`,
      `${infinitive}de`,
      `${infinitive}t`,
      infinitive,
      1,
    ),
    confidence: 'high',
  };
}

/**
 * The three noun patterns that are safe to guess. Anything else — an `en` word
 * ending in a vowel, an `ett` word ending in a vowel — comes back empty.
 */
export function suggestNounForms(input: string, gender: 'en' | 'ett'): FormsSuggestion {
  const indefSg = input.trim().toLowerCase();
  if (!/^[a-zåäö]{2,}$/.test(indefSg)) return UNKNOWN;

  const endsInConsonant = !VOWELS.includes(indefSg.slice(-1));
  if (!endsInConsonant) return UNKNOWN;

  if (gender === 'en') {
    return {
      suggestion: {
        kind: 'noun',
        gender,
        indefSg,
        defSg: `${indefSg}en`,
        indefPl: `${indefSg}ar`,
        defPl: `${indefSg}arna`,
      },
      confidence: 'high',
    };
  }

  // `ett hus → huset, hus, husen`: the plural is the bare noun again.
  return {
    suggestion: {
      kind: 'noun',
      gender,
      indefSg,
      defSg: `${indefSg}et`,
      indefPl: indefSg,
      defPl: `${indefSg}en`,
    },
    confidence: 'high',
  };
}
