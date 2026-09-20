import type { FormEvent, RefObject } from 'react';
import type { Verdict } from '../../lib/checkAnswer';
import type { DiffSegment } from '../../lib/diffChars';
import { diffChars } from '../../lib/diffChars';
import { cx } from '../../utils/cx';
import styles from './AnswerInput.module.css';

export interface AnswerInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /** Undefined while the learner is still typing. */
  verdict?: Verdict;
  /** The accepted answer, shown once a verdict exists. */
  answer?: string;
  /** What was typed at the moment of grading. Frozen so the diff survives a retry. */
  submitted?: string;
  /** Lets the route keep focus in the field and select it on a near miss. */
  inputRef?: RefObject<HTMLInputElement | null>;
}

/**
 * Icons carry the verdict alongside the border colour, so the state is still
 * readable without colour vision.
 */
function VerdictIcon({ verdict }: { verdict: Verdict }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (verdict === 'correct') {
    return (
      <svg {...common}>
        <path d="M4 10.5 8 14.5 16 5.5" />
      </svg>
    );
  }
  if (verdict === 'close') {
    return (
      <svg {...common}>
        <path d="M3 12c1.8-4 3.6-4 5.4 0s3.6 4 5.4 0 3.6-4 3.2-1.4" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M5 5 15 15M15 5 5 15" />
    </svg>
  );
}

function DiffLine({ segments, label }: { segments: DiffSegment[]; label: string }) {
  return (
    <span className={styles.diffLine}>
      <span className={styles.diffLabel} lang="sv">
        {label}
      </span>
      <span>
        {segments.map((segment, index) =>
          segment.marked ? (
            <mark key={index} className={styles.mark}>
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </span>
    </span>
  );
}

function announcement(verdict: Verdict, answer: string, submitted: string): string {
  if (verdict === 'correct') return 'Rätt!';
  if (verdict === 'close') return `Nästan — du skrev ${submitted}, svaret är ${answer}`;
  return `Inte riktigt — svaret är ${answer}`;
}

export function AnswerInput({
  value,
  onChange,
  onSubmit,
  disabled = false,
  verdict,
  answer = '',
  submitted = '',
  inputRef,
}: AnswerInputProps) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  const diff = verdict === 'close' ? diffChars(submitted, answer) : undefined;

  return (
    <form className={styles.wrap} onSubmit={handleSubmit}>
      <div className={cx(styles.field, verdict && styles[verdict])}>
        {verdict && (
          <span className={styles.icon}>
            <VerdictIcon verdict={verdict} />
          </span>
        )}
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="Svara på engelska"
          aria-label="Svara på engelska"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          inputMode="text"
        />
      </div>

      {diff && (
        <p className={styles.diff}>
          <DiffLine segments={diff.typed} label="Du skrev" />
          <DiffLine segments={diff.answer} label="Svaret" />
        </p>
      )}

      <p className={styles.live} aria-live="polite" lang="sv">
        {verdict ? announcement(verdict, answer, submitted) : ''}
      </p>
    </form>
  );
}
