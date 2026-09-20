import { useId, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useDeckStore } from '../../store/useDeckStore';
import { useGameStore } from '../../store/useGameStore';
import {
  backupFilename,
  buildBackup,
  mergeBackup,
  readBackup,
  replaceWith,
  summarize,
} from '../../lib/backup';
import type { BackupContents, BackupFile } from '../../lib/backup';
import styles from './BackupPanel.module.css';

/**
 * Nothing lands in a store until the learner picks Merge or Replace, and
 * Replace asks a second time. A bad file never gets that far.
 */
type Stage =
  | { kind: 'idle' }
  | { kind: 'choosing'; backup: BackupFile }
  | { kind: 'confirming'; backup: BackupFile }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; error: string };

function currentContents(): BackupContents {
  const deck = useDeckStore.getState();
  const game = useGameStore.getState();
  return {
    profile: game.profile,
    userEntries: deck.userEntries,
    userDecks: deck.userDecks,
    stats: game.stats,
    sessionHistory: game.sessionHistory,
  };
}

function apply(contents: BackupContents) {
  useDeckStore.getState().setLibrary(contents.userEntries, contents.userDecks);
  useGameStore.getState().setProgress({
    profile: contents.profile,
    stats: contents.stats,
    sessionHistory: contents.sessionHistory,
  });
}

function download(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Safari on iOS ignores a click on a detached anchor, so it goes in the
  // document first and comes straight back out.
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same tick cancels the download Safari has not started yet.
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/**
 * `Blob.text()` only arrived in iOS Safari 14, and this is the one screen a
 * learner reaches for when their other device has already died.
 */
function readText(file: File, onText: (text: string) => void, onError: () => void) {
  const reader = new FileReader();
  reader.onload = () => {
    onText(typeof reader.result === 'string' ? reader.result : '');
  };
  reader.onerror = onError;
  reader.readAsText(file);
}

function countsSentence(backup: BackupFile): string {
  const { words, decks, stats, sessions } = summarize(backup);
  return `${words} ord, ${decks} listor, ${stats} statistikrader, ${sessions} omgångar.`;
}

export function BackupPanel() {
  const fileInputId = useId();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const handleExport = () => {
    const now = Date.now();
    download(JSON.stringify(buildBackup(currentContents(), now), null, 2), backupFilename(now));
  };

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Picking a file and then cancelling fires a change with nothing in it.
    if (file === undefined) return;

    // Without this, choosing the same file twice in a row fires no change.
    event.target.value = '';

    readText(
      file,
      (text) => {
        const result = readBackup(text);
        setStage(
          result.ok
            ? { kind: 'choosing', backup: result.backup }
            : { kind: 'failed', error: result.error },
        );
      },
      () => {
        setStage({ kind: 'failed', error: 'Filen gick inte att läsa.' });
      },
    );
  };

  const handleMerge = (backup: BackupFile) => {
    const merged = mergeBackup(currentContents(), backup);
    apply(merged);
    setStage({ kind: 'done', message: `Sammanfogat. Du har nu ${merged.userEntries.length} egna ord.` });
  };

  const handleReplace = (backup: BackupFile) => {
    const replaced = replaceWith(backup);
    apply(replaced);
    setStage({ kind: 'done', message: `Ersatt. Du har nu ${replaced.userEntries.length} egna ord.` });
  };

  return (
    <section className={styles.panel} aria-labelledby={`${fileInputId}-heading`}>
      <h2 className={styles.heading} id={`${fileInputId}-heading`} lang="sv">
        Säkerhetskopia
      </h2>

      <button type="button" className={styles.action} onClick={handleExport} lang="sv">
        Exportera till fil
      </button>

      <label className={styles.action} htmlFor={fileInputId} lang="sv">
        Importera från fil
        <input
          id={fileInputId}
          className={styles.file}
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
        />
      </label>

      {stage.kind === 'choosing' && (
        <div className={styles.summary}>
          <p className={styles.counts} role="status" lang="sv">
            {countsSentence(stage.backup)}
          </p>
          <div className={styles.choices}>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                handleMerge(stage.backup);
              }}
              lang="sv"
            >
              Slå ihop
            </button>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                setStage({ kind: 'confirming', backup: stage.backup });
              }}
              lang="sv"
            >
              Ersätt allt
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'confirming' && (
        <div className={styles.summary}>
          <p className={styles.counts} role="alert" lang="sv">
            Det här raderar dina egna ord och all statistik. Säkert?
          </p>
          <div className={styles.choices}>
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                handleReplace(stage.backup);
              }}
              lang="sv"
            >
              Ja, ersätt allt
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setStage({ kind: 'choosing', backup: stage.backup });
              }}
              lang="sv"
            >
              Avbryt
            </button>
          </div>
        </div>
      )}

      {stage.kind === 'done' && (
        <p className={styles.done} role="status" lang="sv">
          {stage.message}
        </p>
      )}

      {stage.kind === 'failed' && (
        <p className={styles.error} role="alert" lang="sv">
          {`${stage.error} Inget importerades.`}
        </p>
      )}
    </section>
  );
}
