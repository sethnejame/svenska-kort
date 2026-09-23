import { useEffect, useRef, useState } from 'react';
import { cx } from '../../utils/cx';
import styles from './SpecialChars.module.css';

/** Lower and upper case together, in keyboard-layout order, not alphabetical. */
const CHARS = ['å', 'ä', 'ö', 'Å', 'Ä', 'Ö'] as const;

/** How long the "Kopierat!" state holds before the chip goes quiet again. */
const CONFIRM_MS = 1200;

function canCopy(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

/**
 * A learner without a Swedish keyboard has no way to type åäö at all. Tapping
 * a chip here copies the character so it can be pasted into the field.
 * Hidden entirely where the Clipboard API does not exist, same as the mic in
 * `AnswerInput` — a control that cannot work is worse than no control.
 */
export function SpecialChars() {
  const [copied, setCopied] = useState<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!canCopy()) return null;

  const handleCopy = (char: string) => {
    // The API can exist and still refuse — some browsers gate clipboard-write
    // behind a permission the page was never granted. Silence, not a crash.
    navigator.clipboard
      .writeText(char)
      .then(() => {
        clearTimeout(timer.current);
        setCopied(char);
        timer.current = setTimeout(() => setCopied(undefined), CONFIRM_MS);
      })
      .catch(() => {});
  };

  return (
    <div className={styles.wrap} role="group" aria-label="Specialtecken">
      {CHARS.map((char) => (
        <button
          key={char}
          type="button"
          className={cx(styles.chip, copied === char && styles.copied)}
          onClick={() => handleCopy(char)}
          aria-label={`Kopiera ${char}`}
          lang="sv"
        >
          {copied === char ? 'Kopierat!' : char}
        </button>
      ))}
      <p className={styles.live} aria-live="polite" lang="sv">
        {copied ? `${copied} kopierat` : ''}
      </p>
    </div>
  );
}
