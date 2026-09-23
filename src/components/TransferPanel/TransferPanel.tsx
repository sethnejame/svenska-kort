import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { claimTransferCode, createTransferCode } from '../../services/transfer';
import { setToken } from '../../services/deviceToken';
import { size as outboxSize } from '../../services/outbox';
import { cx } from '../../utils/cx';
import styles from './TransferPanel.module.css';

/** How long the "Kopierat!" state holds, same pacing as `SpecialChars`. */
const COPY_CONFIRM_MS = 1200;

type CreateStage =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'created'; code: string; expiresAt: string }
  | { kind: 'error'; message: string };

/**
 * `confirming` carries its own `code`: the learner may still be editing the
 * field by the time they answer the confirm, and the claim must use exactly
 * what they had typed when they pressed submit, not whatever is in the box now.
 */
type ClaimStage =
  | { kind: 'idle' }
  | { kind: 'confirming'; code: string; unsynced: number }
  | { kind: 'claiming' }
  | { kind: 'error'; message: string };

function canCopy(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Något gick fel.';
}

function remainingSeconds(expiresAt: string, now: number): number {
  return Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

/**
 * The only supported way to move an account: a short-lived, single-use code
 * read aloud from one device and typed into another. Two independent flows
 * live in one panel because either device could be the one making the code
 * or the one claiming it.
 */
export function TransferPanel() {
  const [createStage, setCreateStage] = useState<CreateStage>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const [code, setCode] = useState('');
  const [claimStage, setClaimStage] = useState<ClaimStage>({ kind: 'idle' });

  useEffect(() => () => clearTimeout(copyTimer.current), []);

  // Ticks once a second only while a code is on screen to countdown against.
  useEffect(() => {
    if (createStage.kind !== 'created') return undefined;
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [createStage.kind]);

  const handleCreate = () => {
    setCreateStage({ kind: 'creating' });
    createTransferCode()
      .then((created) => {
        setNow(Date.now());
        setCreateStage({ kind: 'created', code: created.code, expiresAt: created.expiresAt });
      })
      .catch((error: unknown) => {
        setCreateStage({ kind: 'error', message: errorMessage(error) });
      });
  };

  const handleCopy = (value: string) => {
    if (!canCopy()) return;
    navigator.clipboard
      .writeText(value)
      .then(() => {
        clearTimeout(copyTimer.current);
        setCopied(true);
        copyTimer.current = setTimeout(() => setCopied(false), COPY_CONFIRM_MS);
      })
      .catch(() => {});
  };

  const runClaim = (value: string) => {
    setClaimStage({ kind: 'claiming' });
    claimTransferCode(value)
      .then((token) => {
        setToken(token);
        window.location.reload();
      })
      .catch((error: unknown) => {
        setClaimStage({ kind: 'error', message: errorMessage(error) });
      });
  };

  const handleClaimSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed.length === 0) return;

    const unsynced = outboxSize();
    if (unsynced > 0) {
      setClaimStage({ kind: 'confirming', code: trimmed, unsynced });
      return;
    }
    runClaim(trimmed);
  };

  const claiming = claimStage.kind === 'claiming';

  return (
    <section className={styles.panel} aria-labelledby="transfer-heading">
      <h2 className={styles.heading} id="transfer-heading" lang="sv">
        Flytta konto
      </h2>

      <div className={styles.block}>
        <h3 className={styles.subheading} lang="sv">
          Använd på en annan enhet
        </h3>

        {createStage.kind === 'idle' && (
          <button type="button" className={styles.action} onClick={handleCreate} lang="sv">
            Skapa kod
          </button>
        )}

        {createStage.kind === 'creating' && (
          <p className={styles.hint} role="status" lang="sv">
            Skapar kod …
          </p>
        )}

        {createStage.kind === 'created' && (
          <CreatedCode
            code={createStage.code}
            expiresAt={createStage.expiresAt}
            now={now}
            copied={copied}
            onCopy={handleCopy}
            onRestart={handleCreate}
          />
        )}

        {createStage.kind === 'error' && (
          <div className={styles.summary}>
            <p className={styles.error} role="alert" lang="sv">
              {createStage.message}
            </p>
            <button type="button" className={styles.action} onClick={handleCreate} lang="sv">
              Försök igen
            </button>
          </div>
        )}
      </div>

      <div className={styles.block}>
        <h3 className={styles.subheading} lang="sv">
          Jag har en kod
        </h3>

        {claimStage.kind === 'confirming' ? (
          <div className={styles.summary}>
            <p className={styles.counts} role="alert" lang="sv">
              {`Den här enheten har ${String(claimStage.unsynced)} omgångar som inte är synkade. De skrivs över.`}
            </p>
            <div className={styles.choices}>
              <button
                type="button"
                className={styles.danger}
                onClick={() => {
                  runClaim(claimStage.code);
                }}
                lang="sv"
              >
                Fortsätt
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={() => {
                  setClaimStage({ kind: 'idle' });
                }}
                lang="sv"
              >
                Avbryt
              </button>
            </div>
          </div>
        ) : (
          <form className={styles.form} onSubmit={handleClaimSubmit}>
            <label className={styles.field}>
              <span className={styles.label} lang="sv">
                Kod
              </span>
              <input
                className={styles.input}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                  if (claimStage.kind === 'error') setClaimStage({ kind: 'idle' });
                }}
                placeholder="ABCD-EFGH"
                maxLength={9}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="done"
                disabled={claiming}
                aria-invalid={claimStage.kind === 'error'}
                aria-describedby={claimStage.kind === 'error' ? 'transfer-claim-error' : undefined}
              />
            </label>

            {claimStage.kind === 'error' && (
              <p id="transfer-claim-error" className={styles.error} role="alert" lang="sv">
                {claimStage.message}
              </p>
            )}

            <button type="submit" className={styles.action} disabled={claiming} lang="sv">
              {claiming ? 'Hämtar …' : 'Använd kod'}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

interface CreatedCodeProps {
  code: string;
  expiresAt: string;
  now: number;
  copied: boolean;
  onCopy: (value: string) => void;
  onRestart: () => void;
}

function CreatedCode({ code, expiresAt, now, copied, onCopy, onRestart }: CreatedCodeProps) {
  const remaining = remainingSeconds(expiresAt, now);

  if (remaining === 0) {
    return (
      <div className={styles.summary}>
        <p className={styles.hint} role="status" lang="sv">
          Koden har gått ut.
        </p>
        <button type="button" className={styles.action} onClick={onRestart} lang="sv">
          Skapa ny kod
        </button>
      </div>
    );
  }

  return (
    <div className={styles.summary}>
      <p className={styles.code} aria-label={`Koden är ${code}`}>
        {code}
      </p>
      <p className={styles.countdown} role="status" lang="sv">
        {`Går ut om ${formatCountdown(remaining)}`}
      </p>
      {canCopy() && (
        <button
          type="button"
          className={cx(styles.action, copied && styles.copied)}
          onClick={() => {
            onCopy(code);
          }}
          lang="sv"
        >
          {copied ? 'Kopierat!' : 'Kopiera kod'}
        </button>
      )}
    </div>
  );
}
