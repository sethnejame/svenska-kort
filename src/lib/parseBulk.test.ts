import { describe, expect, it } from 'vitest';
import { parseBulk } from './parseBulk';

const SAMPLE = `förberedd - prepared
antal / antalet - number / the number
gillar - likes, like        # note: easier than "tycker om"
minskade - decreased        @verb minska/minskar/minskade/minskat
"fast jag tycker" - although I think`;

describe('parseBulk', () => {
  it('parses the sample from the notes, every line', () => {
    const rows = parseBulk(SAMPLE);

    expect(rows).toHaveLength(5);
    expect(rows.every((row) => row.ok)).toBe(true);
    expect(rows.map((row) => row.lineNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps the swedish exactly as written, slash and all', () => {
    const [, row] = parseBulk(SAMPLE);
    expect(row?.entry).toMatchObject({
      swedish: 'antal / antalet',
      english: ['number', 'the number'],
    });
  });

  it('takes a comma on the english side as a second answer', () => {
    const row = parseBulk(SAMPLE)[2];
    expect(row?.entry?.english).toEqual(['likes', 'like']);
  });

  it('gives everything after a hash to the note, quotes included', () => {
    const row = parseBulk(SAMPLE)[2];
    expect(row?.entry?.note).toBe('note: easier than "tycker om"');
  });

  it('fills a verb paradigm and works out its group', () => {
    const row = parseBulk(SAMPLE)[3];
    expect(row?.entry).toMatchObject({
      swedish: 'minskade',
      pos: 'verb',
      forms: {
        kind: 'verb',
        infinitive: 'minska',
        present: 'minskar',
        past: 'minskade',
        supine: 'minskat',
        group: 1,
      },
    });
  });

  it('strips the quotes and calls a quoted line a phrase', () => {
    const row = parseBulk(SAMPLE)[4];
    expect(row?.entry).toMatchObject({
      swedish: 'fast jag tycker',
      pos: 'phrase',
      forms: { kind: 'none' },
    });
  });

  it('flags a line with no separator without dropping it or the rest', () => {
    const rows = parseBulk(`${SAMPLE}\nförmål objects`);

    expect(rows).toHaveLength(6);
    expect(rows[5]).toMatchObject({
      lineNumber: 6,
      ok: false,
      error: "no ' - ' separator found",
    });
    expect(rows.filter((row) => row.ok)).toHaveLength(5);
  });

  it('skips blank lines and comments without counting them as rows', () => {
    const rows = parseBulk('// mina ord\n\nhus - house\n   \n');

    expect(rows).toHaveLength(1);
    // The line number still points at the line the learner sees.
    expect(rows[0]?.lineNumber).toBe(3);
  });

  it('accepts an en dash as readily as a hyphen', () => {
    const row = parseBulk('hus – house')[0];
    expect(row?.entry).toMatchObject({ swedish: 'hus', english: ['house'] });
  });

  it('splits on the first separator only', () => {
    const row = parseBulk('nedgång - decline - as in a fall')[0];
    expect(row?.entry?.swedish).toBe('nedgång');
    expect(row?.entry?.english).toEqual(['decline - as in a fall']);
  });

  it('says how many verb forms it wanted', () => {
    const row = parseBulk('minskade - decreased @verb minska/minskar/minskade')[0];
    expect(row).toMatchObject({ ok: false, error: 'expected 4 forms, got 3' });
  });

  it('counts a form left blank as missing', () => {
    const row = parseBulk('minskade - decreased @verb minska//minskade/minskat')[0];
    expect(row).toMatchObject({ ok: false, error: 'expected 4 forms, got 4' });
  });

  it('says how many noun forms it wanted', () => {
    const row = parseBulk('regering - government @noun en/regering/regeringen')[0];
    expect(row).toMatchObject({ ok: false, error: 'expected 5 forms, got 3' });
  });

  it('rejects one form too many', () => {
    const row = parseBulk('snabb - fast @adjective snabb/snabbt/snabba/snabbare')[0];
    expect(row).toMatchObject({ ok: false, error: 'expected 3 forms, got 4' });
  });

  it('fills a noun paradigm', () => {
    const row = parseBulk(
      'regering - government @noun en/regering/regeringen/regeringar/regeringarna',
    )[0];
    expect(row?.entry?.forms).toEqual({
      kind: 'noun',
      gender: 'en',
      indefSg: 'regering',
      defSg: 'regeringen',
      indefPl: 'regeringar',
      defPl: 'regeringarna',
    });
  });

  it('refuses a gender that is neither en nor ett', () => {
    const row = parseBulk('regering - government @noun der/a/b/c/d')[0];
    expect(row).toMatchObject({ ok: false, error: "gender must be 'en' or 'ett', got 'der'" });
  });

  it('fills an adjective paradigm', () => {
    const row = parseBulk('snabb - fast @adjective snabb/snabbt/snabba')[0];
    expect(row?.entry?.forms).toEqual({
      kind: 'adjective',
      base: 'snabb',
      neuter: 'snabbt',
      plural: 'snabba',
    });
  });

  it('reads the group off the past tense', () => {
    const groups = [
      ['talade', 1],
      ['bodde', 3],
      ['ringde', 2],
      ['läste', 2],
      ['drack', 4],
    ] as const;

    for (const [past, group] of groups) {
      const row = parseBulk(`x - y @verb a/b/${past}/d`)[0];
      expect(row?.entry?.forms, past).toMatchObject({ group });
    }
  });

  it('refuses a paradigm on a part of speech that has none', () => {
    const row = parseBulk('alltså - so @adverb a/b/c')[0];
    expect(row).toMatchObject({ ok: false, error: '@adverb takes no forms' });
  });

  it('takes a bare tag with no paradigm', () => {
    const row = parseBulk('alltså - so, therefore @adverb')[0];
    expect(row?.entry).toMatchObject({ pos: 'adverb', english: ['so', 'therefore'] });
    expect(row?.entry?.forms).toBeUndefined();
  });

  it('names an unknown tag rather than guessing', () => {
    const row = parseBulk('x - y @particle')[0];
    expect(row).toMatchObject({ ok: false, error: "unknown part of speech '@particle'" });
  });

  it('reads a tag whatever its case', () => {
    expect(parseBulk('x - y @Verb a/b/c/d')[0]?.entry?.pos).toBe('verb');
  });

  it('lets an explicit tag beat the quotes', () => {
    const row = parseBulk('"lagen" - the teams @noun en/lag/laget/lag/lagen')[0];
    expect(row?.entry).toMatchObject({ swedish: 'lagen', pos: 'noun' });
  });

  it('guesses phrase for several words and other for one', () => {
    expect(parseBulk('det gör inget - never mind')[0]?.entry).toMatchObject({
      pos: 'phrase',
      forms: { kind: 'none' },
    });
    expect(parseBulk('nog - probably')[0]?.entry?.pos).toBe('other');
  });

  it('ignores a trailing comma on the english side', () => {
    expect(parseBulk('gillar - likes, like,')[0]?.entry?.english).toEqual(['likes', 'like']);
  });

  it('flags a line with nothing on one side', () => {
    expect(parseBulk('  - house')[0]).toMatchObject({
      ok: false,
      error: 'no swedish word found',
    });
    expect(parseBulk('hus -   ')[0]).toMatchObject({
      ok: false,
      error: 'no english translation found',
    });
  });

  it('keeps a lone quotation mark out of the phrase rule', () => {
    expect(parseBulk('" - quote mark')[0]?.entry?.swedish).toBe('"');
  });

  it('hands back an empty list for an empty paste', () => {
    expect(parseBulk('')).toEqual([]);
  });
});
