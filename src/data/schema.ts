import { z } from 'zod';
import type { WordEntry } from '../types/word';

const nonEmpty = z.string().trim().min(1);

export const partOfSpeechSchema = z.enum([
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

export const wordFormsSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('noun'),
    gender: z.enum(['en', 'ett']),
    indefSg: nonEmpty,
    defSg: nonEmpty,
    indefPl: nonEmpty,
    defPl: nonEmpty,
  }),
  z.object({
    kind: z.literal('verb'),
    infinitive: nonEmpty,
    present: nonEmpty,
    past: nonEmpty,
    supine: nonEmpty,
    imperative: nonEmpty.optional(),
    group: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  }),
  z.object({
    kind: z.literal('adjective'),
    base: nonEmpty,
    neuter: nonEmpty,
    plural: nonEmpty,
    comparative: nonEmpty.optional(),
    superlative: nonEmpty.optional(),
  }),
  z.object({ kind: z.literal('none') }),
]);

export const wordEntrySchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/, 'id must be lowercase a-z, 0-9 and hyphens only'),
    swedish: nonEmpty,
    lemma: nonEmpty.optional(),
    english: z.array(nonEmpty).min(1, 'english needs at least one accepted answer'),
    pos: partOfSpeechSchema,
    forms: wordFormsSchema.optional(),
    example: z.object({ sv: nonEmpty, en: nonEmpty }).optional(),
    note: nonEmpty.optional(),
    tags: z.array(nonEmpty).optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.pos === 'phrase' && entry.forms?.kind !== 'none') {
      ctx.addIssue({
        code: 'custom',
        path: ['forms'],
        message: "pos 'phrase' must pair with forms.kind 'none'",
      });
    }
  });

export const entriesFileSchema = z.array(wordEntrySchema);

export type ValidatedWordEntry = z.infer<typeof wordEntrySchema>;

// The schema is structural; this function is the compile-time proof it matches WordEntry.
export const asWordEntry = (entry: ValidatedWordEntry): WordEntry => entry;
