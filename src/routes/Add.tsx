import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router';
import type { PartOfSpeech, WordEntry, WordForms } from '../types/word';
import { asWordEntry, wordEntrySchema } from '../data/schema';
import { ALL_ENTRIES } from '../data/decks';
import { useDeckStore } from '../store/useDeckStore';
import { entryId } from '../lib/entryId';
import type { ParsedLine } from '../lib/parseBulk';
import { parseBulk } from '../lib/parseBulk';
import { suggestNounForms, suggestVerbForms } from '../lib/swedishMorphology';
import { cx } from '../utils/cx';
import styles from './Add.module.css';

type Tab = 'single' | 'bulk';
type Gender = 'en' | 'ett';
type VerbGroup = '' | '1' | '2' | '3' | '4';
type Level = '' | '1' | '2' | '3';

interface NounDraft {
  gender: Gender;
  indefSg: string;
  defSg: string;
  indefPl: string;
  defPl: string;
}
interface VerbDraft {
  infinitive: string;
  present: string;
  past: string;
  supine: string;
  imperative: string;
  group: VerbGroup;
}
interface AdjectiveDraft {
  base: string;
  neuter: string;
  plural: string;
  comparative: string;
  superlative: string;
}

const EMPTY_NOUN: NounDraft = { gender: 'en', indefSg: '', defSg: '', indefPl: '', defPl: '' };
const EMPTY_VERB: VerbDraft = {
  infinitive: '',
  present: '',
  past: '',
  supine: '',
  imperative: '',
  group: '',
};
const EMPTY_ADJECTIVE: AdjectiveDraft = {
  base: '',
  neuter: '',
  plural: '',
  comparative: '',
  superlative: '',
};

const POS_LABELS: Record<PartOfSpeech, string> = {
  noun: 'Substantiv',
  verb: 'Verb',
  adjective: 'Adjektiv',
  adverb: 'Adverb',
  pronoun: 'Pronomen',
  preposition: 'Preposition',
  conjunction: 'Konjunktion',
  numeral: 'Räkneord',
  phrase: 'Fras',
  other: 'Annat',
};

const POS_ORDER = Object.keys(POS_LABELS) as PartOfSpeech[];

/**
 * Only the sub-form belonging to the current part of speech is read, so a draft
 * left behind by a different part of speech can never reach the saved entry.
 */
function buildForms(
  pos: PartOfSpeech,
  noun: NounDraft,
  verb: VerbDraft,
  adjective: AdjectiveDraft,
): WordForms | undefined {
  if (pos === 'phrase') return { kind: 'none' };

  if (pos === 'noun') {
    const { indefSg, defSg, indefPl, defPl } = noun;
    if (indefSg === '' || defSg === '' || indefPl === '' || defPl === '') return undefined;
    return { kind: 'noun', gender: noun.gender, indefSg, defSg, indefPl, defPl };
  }

  if (pos === 'verb') {
    const { infinitive, present, past, supine } = verb;
    if (infinitive === '' || present === '' || past === '' || supine === '') return undefined;
    return {
      kind: 'verb',
      infinitive,
      present,
      past,
      supine,
      ...(verb.imperative === '' ? {} : { imperative: verb.imperative }),
      ...(verb.group === '' ? {} : { group: Number(verb.group) as 1 | 2 | 3 | 4 }),
    };
  }

  if (pos === 'adjective') {
    const { base, neuter, plural } = adjective;
    if (base === '' || neuter === '' || plural === '') return undefined;
    return {
      kind: 'adjective',
      base,
      neuter,
      plural,
      ...(adjective.comparative === '' ? {} : { comparative: adjective.comparative }),
      ...(adjective.superlative === '' ? {} : { superlative: adjective.superlative }),
    };
  }

  return undefined;
}

function isBlank(pos: PartOfSpeech, noun: NounDraft, verb: VerbDraft): boolean {
  if (pos === 'noun') {
    return noun.indefSg === '' && noun.defSg === '' && noun.indefPl === '' && noun.defPl === '';
  }
  return verb.infinitive === '' && verb.present === '' && verb.past === '' && verb.supine === '';
}

export function Add() {
  const [tab, setTab] = useState<Tab>('single');

  const userEntries = useDeckStore((s) => s.userEntries);
  const addEntry = useDeckStore((s) => s.addEntry);
  const addEntries = useDeckStore((s) => s.addEntries);

  const [swedish, setSwedish] = useState('');
  const [lemma, setLemma] = useState('');
  const [english, setEnglish] = useState<string[]>([]);
  const [englishDraft, setEnglishDraft] = useState('');
  const [pos, setPos] = useState<PartOfSpeech>('noun');
  const [noun, setNoun] = useState<NounDraft>(EMPTY_NOUN);
  const [verb, setVerb] = useState<VerbDraft>(EMPTY_VERB);
  const [adjective, setAdjective] = useState<AdjectiveDraft>(EMPTY_ADJECTIVE);
  const [exampleSv, setExampleSv] = useState('');
  const [exampleEn, setExampleEn] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [level, setLevel] = useState<Level>('');

  const [suggested, setSuggested] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const [paste, setPaste] = useState('');
  const [imported, setImported] = useState<string | null>(null);
  // Cheap enough to re-run on every keystroke, and it keeps the preview honest.
  const rows = useMemo(() => parseBulk(paste), [paste]);
  const ready = rows.filter((row) => row.ok);

  // Mirrors `suggested` for the autofill effect, which must not re-run just
  // because the chip appeared or went away.
  const wasSuggested = useRef(false);
  const mark = (on: boolean) => {
    wasSuggested.current = on;
    setSuggested(on);
  };

  const gender = noun.gender;

  // Read inside the effect without joining its dependency list, so typing in a
  // forms field does not re-trigger the suggestion.
  const isBlankNow = useRef(() => isBlank(pos, noun, verb));
  isBlankNow.current = () => isBlank(pos, noun, verb);

  // Autofill never clobbers work the learner typed: it writes only when the
  // sub-form is still empty or holds a previous suggestion.
  useEffect(() => {
    if (pos !== 'verb' && pos !== 'noun') {
      mark(false);
      return;
    }

    const word = lemma.trim() === '' ? swedish.trim() : lemma.trim();
    const suggestion =
      pos === 'verb' ? suggestVerbForms(word).suggestion : suggestNounForms(word, gender).suggestion;

    if (suggestion === null) {
      // A strong verb has no rule. Clearing a stale guess is right; clearing
      // the learner's own answer is not.
      if (wasSuggested.current) {
        setVerb(EMPTY_VERB);
        setNoun((current) => ({ ...EMPTY_NOUN, gender: current.gender }));
        mark(false);
      }
      return;
    }

    if (!wasSuggested.current && !isBlankNow.current()) return;

    if (suggestion.kind === 'verb') {
      setVerb({
        infinitive: suggestion.infinitive,
        present: suggestion.present,
        past: suggestion.past,
        supine: suggestion.supine,
        imperative: suggestion.imperative ?? '',
        group: suggestion.group === undefined ? '' : (String(suggestion.group) as VerbGroup),
      });
    } else if (suggestion.kind === 'noun') {
      setNoun({
        gender: suggestion.gender,
        indefSg: suggestion.indefSg,
        defSg: suggestion.defSg,
        indefPl: suggestion.indefPl,
        defPl: suggestion.defPl,
      });
    }
    mark(true);
  }, [pos, swedish, lemma, gender]);

  const clearError = (field: string) => {
    setErrors((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const editForms = () => {
    setSaved(null);
    if (suggested) mark(false);
  };

  const changePos = (next: PartOfSpeech) => {
    setPos(next);
    // Nothing from the old part of speech survives the switch.
    setNoun(EMPTY_NOUN);
    setVerb(EMPTY_VERB);
    setAdjective(EMPTY_ADJECTIVE);
    mark(false);
    setSaved(null);
  };

  const addEnglish = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === '') return;
    setEnglish((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setEnglishDraft('');
    clearError('english');
  };

  const addTag = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === '') return;
    setTags((current) => (current.includes(trimmed) ? current : [...current, trimmed]));
    setTagDraft('');
  };

  const reset = () => {
    setSwedish('');
    setLemma('');
    setEnglish([]);
    setEnglishDraft('');
    setNoun(EMPTY_NOUN);
    setVerb(EMPTY_VERB);
    setAdjective(EMPTY_ADJECTIVE);
    setExampleSv('');
    setExampleEn('');
    setNote('');
    setTags([]);
    setTagDraft('');
    setLevel('');
    mark(false);
  };

  const takenIds = () =>
    new Set([...ALL_ENTRIES.map((entry) => entry.id), ...userEntries.map((entry) => entry.id)]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const sv = swedish.trim();
    // Text still sitting in the add field counts: the learner typed it.
    const answers = englishDraft.trim() === '' ? english : [...english, englishDraft.trim()];

    const found: Record<string, string> = {};
    if (sv === '') found['swedish'] = 'Skriv ordet på svenska.';
    if (answers.length === 0) found['english'] = 'Lägg till minst en engelsk översättning.';
    if (Object.keys(found).length > 0) {
      setErrors(found);
      return;
    }

    const lemmaTrimmed = lemma.trim();
    const taken = takenIds();
    const forms = buildForms(pos, noun, verb, adjective);

    const candidate = {
      id: entryId(lemmaTrimmed === '' ? sv : lemmaTrimmed, pos, taken),
      swedish: sv,
      english: answers,
      pos,
      ...(lemmaTrimmed === '' ? {} : { lemma: lemmaTrimmed }),
      ...(forms === undefined ? {} : { forms }),
      ...(exampleSv.trim() === '' || exampleEn.trim() === ''
        ? {}
        : { example: { sv: exampleSv.trim(), en: exampleEn.trim() } }),
      ...(note.trim() === '' ? {} : { note: note.trim() }),
      ...(tags.length === 0 ? {} : { tags }),
      ...(level === '' ? {} : { level: Number(level) as 1 | 2 | 3 }),
    };

    const parsed = wordEntrySchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setErrors({ form: issue?.message ?? 'Något stämmer inte i formuläret.' });
      return;
    }

    const entry: WordEntry = asWordEntry(parsed.data);
    addEntry(entry);
    setErrors({});
    setSaved(entry.swedish);
    reset();
  };

  /** Moves one parsed row onto the single-entry form so it can be corrected. */
  const editRow = (row: ParsedLine) => {
    const draft = row.entry ?? {};
    const nextPos = draft.pos ?? 'other';

    reset();
    setSwedish(draft.swedish ?? '');
    setEnglish(draft.english ?? []);
    setPos(nextPos);
    setNote(draft.note ?? '');

    const forms = draft.forms;
    if (forms?.kind === 'noun') {
      setNoun({
        gender: forms.gender,
        indefSg: forms.indefSg,
        defSg: forms.defSg,
        indefPl: forms.indefPl,
        defPl: forms.defPl,
      });
    } else if (forms?.kind === 'verb') {
      setVerb({
        infinitive: forms.infinitive,
        present: forms.present,
        past: forms.past,
        supine: forms.supine,
        imperative: forms.imperative ?? '',
        group: forms.group === undefined ? '' : (String(forms.group) as VerbGroup),
      });
    }

    // The line leaves the paste box, so correcting it cannot also import it.
    setPaste((current) =>
      current
        .split(/\r?\n/)
        .filter((_, index) => index + 1 !== row.lineNumber)
        .join('\n'),
    );
    setErrors({});
    setSaved(null);
    setTab('single');
  };

  const handleImport = () => {
    const taken = takenIds();
    const entries: WordEntry[] = [];

    for (const row of ready) {
      const draft = row.entry;
      if (draft === undefined) continue;

      const candidate = {
        ...draft,
        id: entryId(draft.lemma ?? draft.swedish ?? '', draft.pos ?? 'other', taken),
      };
      const parsed = wordEntrySchema.safeParse(candidate);
      if (!parsed.success) continue;

      // Added to the taken set as we go, or two identical lines would collide.
      taken.add(candidate.id);
      entries.push(asWordEntry(parsed.data));
    }

    addEntries(entries);
    setImported(`${entries.length} ord sparade.`);
    setPaste('');
  };

  const formsError = errors['form'];

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title} lang="sv">
          Lägg till ord
        </h1>
        <Link to="/decks" className={styles.back} lang="sv">
          Till lekarna
        </Link>
      </header>

      <div className={styles.segmented} role="tablist" aria-label="Sätt att lägga till">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'single'}
          className={cx(styles.segment, tab === 'single' && styles.segmentActive)}
          onClick={() => {
            setTab('single');
          }}
          lang="sv"
        >
          Ett ord
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'bulk'}
          className={cx(styles.segment, tab === 'bulk' && styles.segmentActive)}
          onClick={() => {
            setTab('bulk');
          }}
          lang="sv"
        >
          Klistra in lista
        </button>
      </div>

      {tab === 'bulk' ? (
        <div className={styles.bulk}>
          {imported !== null && (
            <p className={styles.saved} role="status" lang="sv">
              {imported}
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Ett ord per rad: svenska - engelska
            </span>
            <textarea
              className={styles.textarea}
              value={paste}
              onChange={(event) => {
                setPaste(event.target.value);
                setImported(null);
              }}
              rows={8}
              spellCheck={false}
              autoCapitalize="none"
              lang="sv"
            />
          </label>

          <p className={styles.hint} lang="sv">
            {'# börjar en anteckning. @verb a/b/c/d fyller böjningen. '}
            {'Citattecken gör raden till en fras.'}
          </p>

          {rows.length > 0 && (
            <>
              <p className={styles.count} role="status" lang="sv">
                {`${ready.length} klara, ${rows.length - ready.length} behöver ses över`}
              </p>

              {/* The scroll lives on the table, never on the page. */}
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th scope="col" lang="sv">
                        Rad
                      </th>
                      <th scope="col" lang="sv">
                        Svenska
                      </th>
                      <th scope="col" lang="sv">
                        Engelska
                      </th>
                      <th scope="col" lang="sv">
                        Ordklass
                      </th>
                      <th scope="col">
                        <span className={styles.srOnly} lang="sv">
                          Åtgärd
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr
                        key={row.lineNumber}
                        className={row.ok ? undefined : styles.badRow}
                        data-ok={row.ok}
                      >
                        <td>{row.lineNumber}</td>
                        <td lang="sv">{row.ok ? row.entry?.swedish : row.raw.trim()}</td>
                        <td>
                          {row.ok ? (
                            row.entry?.english?.join(', ')
                          ) : (
                            <span className={styles.rowError} lang="sv">
                              {row.error}
                            </span>
                          )}
                        </td>
                        <td lang="sv">
                          {row.ok && row.entry?.pos !== undefined ? POS_LABELS[row.entry.pos] : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className={styles.rowAction}
                            onClick={() => {
                              editRow(row);
                            }}
                            lang="sv"
                            // Twelve buttons all reading "Ändra" tell a screen
                            // reader nothing; the row number is the difference.
                            aria-label={`Ändra rad ${row.lineNumber}`}
                          >
                            Ändra
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                type="button"
                className={styles.submit}
                onClick={handleImport}
                disabled={ready.length === 0}
                lang="sv"
              >
                {`Importera ${ready.length} ord`}
              </button>
            </>
          )}
        </div>
      ) : (
        <form className={styles.form} onSubmit={handleSubmit} noValidate>
          {saved !== null && (
            <p className={styles.saved} role="status" lang="sv">
              {`${saved} är sparat.`}
            </p>
          )}

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Svenska
            </span>
            <input
              className={styles.input}
              value={swedish}
              onChange={(event) => {
                setSwedish(event.target.value);
                setSaved(null);
                clearError('swedish');
              }}
              lang="sv"
              autoCapitalize="none"
              autoComplete="off"
              aria-invalid={'swedish' in errors}
              aria-describedby={'swedish' in errors ? 'add-swedish-error' : undefined}
            />
          </label>
          <p
            id="add-swedish-error"
            className={styles.error}
            role="alert"
            lang="sv"
            hidden={!('swedish' in errors)}
          >
            {errors['swedish']}
          </p>

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Grundform (om ordet är böjt)
            </span>
            <input
              className={styles.input}
              value={lemma}
              onChange={(event) => {
                setLemma(event.target.value);
                setSaved(null);
              }}
              lang="sv"
              autoCapitalize="none"
              autoComplete="off"
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label} lang="sv">
              Engelska
            </span>
            <ul className={styles.chips}>
              {english.map((answer) => (
                <li key={answer}>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => {
                      setEnglish((current) => current.filter((item) => item !== answer));
                    }}
                  >
                    {answer}
                    <span aria-hidden="true">{' \u00d7'}</span>
                    <span className={styles.srOnly} lang="sv">{` — ta bort`}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.row}>
              <input
                className={styles.input}
                value={englishDraft}
                onChange={(event) => {
                  setEnglishDraft(event.target.value);
                  setSaved(null);
                  clearError('english');
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addEnglish(englishDraft);
                }}
                aria-label="Engelska"
                autoCapitalize="none"
                autoComplete="off"
                enterKeyHint="done"
                aria-invalid={'english' in errors}
                aria-describedby={'english' in errors ? 'add-english-error' : undefined}
              />
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  addEnglish(englishDraft);
                }}
                lang="sv"
              >
                Lägg till
              </button>
            </div>
          </div>
          <p
            id="add-english-error"
            className={styles.error}
            role="alert"
            lang="sv"
            hidden={!('english' in errors)}
          >
            {errors['english']}
          </p>

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Ordklass
            </span>
            <select
              className={styles.input}
              value={pos}
              onChange={(event) => {
                changePos(event.target.value as PartOfSpeech);
              }}
              lang="sv"
            >
              {POS_ORDER.map((option) => (
                <option key={option} value={option}>
                  {POS_LABELS[option]}
                </option>
              ))}
            </select>
          </label>

          {(pos === 'noun' || pos === 'verb') && suggested && (
            <div className={styles.suggestion}>
              <span className={styles.suggestionChip} lang="sv">
                Förslag
              </span>
              <button
                type="button"
                className={styles.dismiss}
                onClick={() => {
                  mark(false);
                }}
                lang="sv"
              >
                Dölj
              </button>
            </div>
          )}

          {pos === 'noun' && (
            <fieldset className={styles.group}>
              <legend className={styles.label} lang="sv">
                Böjning
              </legend>
              <label className={styles.field}>
                <span className={styles.label} lang="sv">
                  Genus
                </span>
                <select
                  className={styles.input}
                  value={noun.gender}
                  onChange={(event) => {
                    const next = event.target.value as Gender;
                    setNoun((current) => ({ ...current, gender: next }));
                    setSaved(null);
                  }}
                  lang="sv"
                >
                  <option value="en">en</option>
                  <option value="ett">ett</option>
                </select>
              </label>
              {(
                [
                  ['indefSg', 'Obestämd singular'],
                  ['defSg', 'Bestämd singular'],
                  ['indefPl', 'Obestämd plural'],
                  ['defPl', 'Bestämd plural'],
                ] as [keyof Omit<NounDraft, 'gender'>, string][]
              ).map(([key, label]) => (
                <label key={key} className={styles.field}>
                  <span className={styles.label} lang="sv">
                    {label}
                  </span>
                  <input
                    className={styles.input}
                    value={noun[key]}
                    onChange={(event) => {
                      const next = event.target.value;
                      setNoun((current) => ({ ...current, [key]: next }));
                      editForms();
                    }}
                    lang="sv"
                    autoCapitalize="none"
                    autoComplete="off"
                  />
                </label>
              ))}
            </fieldset>
          )}

          {pos === 'verb' && (
            <fieldset className={styles.group}>
              <legend className={styles.label} lang="sv">
                Böjning
              </legend>
              {(
                [
                  ['infinitive', 'Infinitiv'],
                  ['present', 'Presens'],
                  ['past', 'Preteritum'],
                  ['supine', 'Supinum'],
                  ['imperative', 'Imperativ'],
                ] as [keyof Omit<VerbDraft, 'group'>, string][]
              ).map(([key, label]) => (
                <label key={key} className={styles.field}>
                  <span className={styles.label} lang="sv">
                    {label}
                  </span>
                  <input
                    className={styles.input}
                    value={verb[key]}
                    onChange={(event) => {
                      const next = event.target.value;
                      setVerb((current) => ({ ...current, [key]: next }));
                      editForms();
                    }}
                    lang="sv"
                    autoCapitalize="none"
                    autoComplete="off"
                  />
                </label>
              ))}
              <label className={styles.field}>
                <span className={styles.label} lang="sv">
                  Grupp
                </span>
                <select
                  className={styles.input}
                  value={verb.group}
                  onChange={(event) => {
                    const next = event.target.value as VerbGroup;
                    setVerb((current) => ({ ...current, group: next }));
                    editForms();
                  }}
                  lang="sv"
                >
                  <option value="">—</option>
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3">3</option>
                  <option value="4">4</option>
                </select>
              </label>
            </fieldset>
          )}

          {pos === 'adjective' && (
            <fieldset className={styles.group}>
              <legend className={styles.label} lang="sv">
                Böjning
              </legend>
              {(
                [
                  ['base', 'Grundform'],
                  ['neuter', 'Neutrum'],
                  ['plural', 'Plural'],
                  ['comparative', 'Komparativ'],
                  ['superlative', 'Superlativ'],
                ] as [keyof AdjectiveDraft, string][]
              ).map(([key, label]) => (
                <label key={key} className={styles.field}>
                  <span className={styles.label} lang="sv">
                    {label}
                  </span>
                  <input
                    className={styles.input}
                    value={adjective[key]}
                    onChange={(event) => {
                      const next = event.target.value;
                      setAdjective((current) => ({ ...current, [key]: next }));
                      editForms();
                    }}
                    lang="sv"
                    autoCapitalize="none"
                    autoComplete="off"
                  />
                </label>
              ))}
            </fieldset>
          )}

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Exempel på svenska
            </span>
            <input
              className={styles.input}
              value={exampleSv}
              onChange={(event) => {
                setExampleSv(event.target.value);
              }}
              lang="sv"
              autoComplete="off"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Exempel på engelska
            </span>
            <input
              className={styles.input}
              value={exampleEn}
              onChange={(event) => {
                setExampleEn(event.target.value);
              }}
              autoComplete="off"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Anteckning
            </span>
            <input
              className={styles.input}
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
              }}
              lang="sv"
              autoComplete="off"
            />
          </label>

          <div className={styles.field}>
            <span className={styles.label} lang="sv">
              Etiketter
            </span>
            <ul className={styles.chips}>
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    className={styles.chip}
                    onClick={() => {
                      setTags((current) => current.filter((item) => item !== tag));
                    }}
                  >
                    {tag}
                    <span aria-hidden="true">{' \u00d7'}</span>
                    <span className={styles.srOnly} lang="sv">{` — ta bort`}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.row}>
              <input
                className={styles.input}
                value={tagDraft}
                onChange={(event) => {
                  setTagDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  addTag(tagDraft);
                }}
                aria-label="Etiketter"
                autoCapitalize="none"
                autoComplete="off"
              />
              <button
                type="button"
                className={styles.secondary}
                onClick={() => {
                  addTag(tagDraft);
                }}
                lang="sv"
              >
                Lägg till
              </button>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.label} lang="sv">
              Nivå
            </span>
            <select
              className={styles.input}
              value={level}
              onChange={(event) => {
                setLevel(event.target.value as Level);
              }}
              lang="sv"
            >
              <option value="">—</option>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>

          <p className={styles.error} role="alert" lang="sv" hidden={formsError === undefined}>
            {formsError}
          </p>

          <button type="submit" className={styles.submit} lang="sv">
            Spara ordet
          </button>
        </form>
      )}
    </main>
  );
}
