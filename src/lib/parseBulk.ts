import type { PartOfSpeech, WordEntry, WordForms } from '../types/word';

/**
 * Parses a page of handwritten notes, one entry per line. Nothing here decides
 * to import: every line comes back as a row, right or wrong, and the screen
 * shows the learner what did and did not survive before anything is saved.
 */

export interface ParsedLine {
  raw: string;
  lineNumber: number;
  ok: boolean;
  entry?: Partial<WordEntry>;
  error?: string;
}

/** A hyphen or an en dash, spaces on both sides. The first one wins. */
const SEPARATOR = / [-–] /;
const SEPARATOR_LENGTH = 3;

const POS_NAMES = new Set<string>([
  'noun',
  'verb',
  'adjective',
  'adverb',
  'pronoun',
  'preposition',
  'conjunction',
  'numeral',
  'phrase',
  'other',
]);

const NOUN_FIELDS = ['gender', 'indefSg', 'defSg', 'indefPl', 'defPl'] as const;
const VERB_FIELDS = ['infinitive', 'present', 'past', 'supine'] as const;
const ADJECTIVE_FIELDS = ['base', 'neuter', 'plural'] as const;

function isPartOfSpeech(name: string): name is PartOfSpeech {
  return POS_NAMES.has(name);
}

/** Splits accepted answers on `/` and `,`; `number / the number` is two answers. */
function alternates(text: string): string[] {
  return text
    .split(/[/,]/)
    .map((piece) => piece.trim())
    .filter((piece) => piece !== '');
}

/**
 * Names the slash-separated fields, or says how many were expected. The count
 * is what the learner needs: the order is on screen next to the paste box.
 */
function named<K extends string>(
  keys: readonly K[],
  parts: readonly string[],
): Record<K, string> | string {
  const wrongCount = `expected ${keys.length} forms, got ${parts.length}`;

  const out = {} as Record<K, string>;
  for (const [index, key] of keys.entries()) {
    const value = parts[index];
    if (value === undefined || value === '') return wrongCount;
    out[key] = value;
  }

  if (parts.length !== keys.length) return wrongCount;
  return out;
}

/**
 * The past tense gives the group away: `-ade` is group 1, `-dde` group 3, any
 * other dental ending group 2, and anything else is strong.
 */
function verbGroup(past: string): 1 | 2 | 3 | 4 {
  if (past.endsWith('ade')) return 1;
  if (past.endsWith('dde')) return 3;
  if (past.endsWith('de') || past.endsWith('te')) return 2;
  return 4;
}

function paradigmForms(pos: PartOfSpeech, paradigm: string): WordForms | string {
  const parts = paradigm.split('/').map((piece) => piece.trim());

  if (pos === 'noun') {
    const fields = named(NOUN_FIELDS, parts);
    if (typeof fields === 'string') return fields;
    if (fields.gender !== 'en' && fields.gender !== 'ett') {
      return `gender must be 'en' or 'ett', got '${fields.gender}'`;
    }
    return { kind: 'noun', ...fields, gender: fields.gender };
  }

  if (pos === 'verb') {
    const fields = named(VERB_FIELDS, parts);
    if (typeof fields === 'string') return fields;
    return { kind: 'verb', ...fields, group: verbGroup(fields.past) };
  }

  if (pos === 'adjective') {
    const fields = named(ADJECTIVE_FIELDS, parts);
    if (typeof fields === 'string') return fields;
    return { kind: 'adjective', ...fields };
  }

  return `@${pos} takes no forms`;
}

function parseLine(raw: string, lineNumber: number): ParsedLine {
  const fail = (error: string): ParsedLine => ({ raw, lineNumber, ok: false, error });

  const at = raw.search(SEPARATOR);
  if (at === -1) return fail("no ' - ' separator found");

  const left = raw.slice(0, at).trim();
  const right = raw.slice(at + SEPARATOR_LENGTH);

  // A `#` ends the translation and starts the note, so a note may contain
  // anything at all — including slashes and quotation marks.
  const hash = right.indexOf('#');
  const note = hash === -1 ? '' : right.slice(hash + 1).trim();
  const beforeNote = hash === -1 ? right : right.slice(0, hash);

  const tag = /@([a-z]+)(?:\s+(\S+))?/i.exec(beforeNote);
  const body =
    tag === null
      ? beforeNote
      : beforeNote.slice(0, tag.index) + beforeNote.slice(tag.index + tag[0].length);

  // Double quotes on the Swedish side mean the learner wrote down a phrase.
  const quoted = left.length > 1 && left.startsWith('"') && left.endsWith('"');
  const swedish = quoted ? left.slice(1, -1).trim() : left;
  if (swedish === '') return fail('no swedish word found');

  const english = alternates(body);
  if (english.length === 0) return fail('no english translation found');

  const tagged = tag?.[1]?.toLowerCase();
  if (tagged !== undefined && !isPartOfSpeech(tagged)) {
    return fail(`unknown part of speech '@${tagged}'`);
  }

  // Without a tag or quotes the shape of the Swedish is all there is to go on,
  // which is why every inference is shown in the preview.
  const pos: PartOfSpeech =
    tagged ?? (quoted || swedish.includes(' ') ? 'phrase' : 'other');

  const paradigm = tag?.[2];
  let forms: WordForms | undefined;

  if (paradigm !== undefined) {
    const built = paradigmForms(pos, paradigm);
    if (typeof built === 'string') return fail(built);
    forms = built;
  } else if (pos === 'phrase') {
    // `wordEntrySchema` insists on the pairing, so the parser honours it too.
    forms = { kind: 'none' };
  }

  return {
    raw,
    lineNumber,
    ok: true,
    entry: {
      swedish,
      english,
      pos,
      ...(forms === undefined ? {} : { forms }),
      ...(note === '' ? {} : { note }),
    },
  };
}

export function parseBulk(text: string): ParsedLine[] {
  const rows: ParsedLine[] = [];

  text.split(/\r?\n/).forEach((raw, index) => {
    const trimmed = raw.trim();
    // Blank lines and `//` comments are not entries and are not mistakes.
    if (trimmed === '' || trimmed.startsWith('//')) return;
    rows.push(parseLine(raw, index + 1));
  });

  return rows;
}
