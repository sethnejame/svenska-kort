import { useMemo } from 'react';
import type { PartOfSpeech, WordEntry } from '../../types/word';
import { FormsTable } from '../FormsTable/FormsTable';
import { cx } from '../../utils/cx';
import styles from './Card.module.css';

const POS_LABEL: Record<PartOfSpeech, string> = {
  noun: 'substantiv',
  verb: 'verb',
  adjective: 'adjektiv',
  adverb: 'adverb',
  pronoun: 'pronomen',
  preposition: 'preposition',
  conjunction: 'konjunktion',
  numeral: 'räkneord',
  phrase: 'fras',
  other: 'ord',
};

/** Step the display size down by grapheme count rather than measuring. */
function sizeClass(swedish: string): string | undefined {
  const length = Array.from(swedish).length;
  if (length > 20) return styles.sizeTiny;
  if (length > 16) return styles.sizeSmall;
  if (length > 12) return styles.sizeMedium;
  return styles.sizeFull;
}

export interface CardProps {
  entry: WordEntry;
  flipped: boolean;
  onFlip?: () => void;
  /** Reverse mode: the English leads and the Swedish is what is being asked for. */
  reverse?: boolean;
}

export function Card({ entry, flipped, onFlip, reverse = false }: CardProps) {
  const size = useMemo(() => sizeClass(entry.swedish), [entry.swedish]);
  const showLemma = entry.lemma !== undefined && entry.lemma !== entry.swedish;
  const prompt = reverse ? entry.english.join(', ') : entry.swedish;

  // The two sides swap wholesale rather than the card being rebuilt: the
  // Swedish side still carries the forms table, whichever face it is on.
  const swedishSide = (
    <>
      <span className={styles.posChip}>{POS_LABEL[entry.pos]}</span>
      <div className={styles.frontBody}>
        <span className={cx(styles.swedish, size)} lang="sv">
          {entry.swedish}
        </span>
        {showLemma && (
          <span className={styles.lemma}>
            av <span lang="sv">{entry.lemma}</span>
          </span>
        )}
      </div>
    </>
  );

  const englishSide = <p className={styles.english}>{entry.english.join(', ')}</p>;

  const detail = (
    <>
      {entry.forms && <FormsTable forms={entry.forms} />}
      {entry.example && (
        <p className={styles.example}>
          <span lang="sv">{entry.example.sv}</span>
          <span className={styles.exampleEn}>{entry.example.en}</span>
        </p>
      )}
      {entry.note && <p className={styles.note}>{entry.note}</p>}
    </>
  );

  const content = (
    <div className={cx(styles.inner, flipped && styles.flipped)}>
      <div className={cx(styles.face, styles.front, reverse && styles.reverseFront)}>
        {reverse ? englishSide : swedishSide}
        {onFlip && <span className={styles.hint}>Tryck för att vända</span>}
      </div>

      <div className={cx(styles.face, styles.back)}>
        {reverse ? swedishSide : englishSide}
        {detail}
      </div>
    </div>
  );

  if (!onFlip) return <div className={styles.card}>{content}</div>;

  return (
    <button
      type="button"
      className={styles.card}
      aria-pressed={flipped}
      aria-label={`${prompt} — tryck för att vända kortet`}
      onClick={onFlip}
    >
      {content}
    </button>
  );
}
