import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../components/Avatar/Avatar';
import { scoreStore } from '../services/scoreStore';
import type { LeaderRow, Scope } from '../services/scoreStore';
import { cx } from '../utils/cx';
import styles from './Leaderboard.module.css';

const TOP_N = 20;
const SKELETON_ROWS = 6;

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'all-time', label: 'Genom tiderna' },
  { value: 'week', label: 'Denna vecka' },
];

type Status = 'loading' | 'ready' | 'error';

export function Leaderboard() {
  const [scope, setScope] = useState<Scope>('all-time');
  const [status, setStatus] = useState<Status>('loading');
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    // A slow scope switch must not land on top of a fast one.
    let current = true;
    setStatus('loading');

    Promise.all([scoreStore.topScores(scope, TOP_N), scoreStore.myRank()])
      .then(([top, mine]) => {
        if (!current) return;
        setRows(top);
        setRank(mine);
        setStatus('ready');
      })
      .catch(() => {
        if (current) setStatus('error');
      });

    return () => {
      current = false;
    };
  }, [scope]);

  // Their own row is already on screen, so the footer would just repeat it.
  const showFooterRank = status === 'ready' && rank !== null && rank > rows.length;

  return (
    <main className={styles.screen}>
      <h1 className={styles.title} lang="sv">
        Topplista
      </h1>

      <div className={styles.scopes} role="tablist" aria-label="Tidsspann">
        {SCOPES.map((choice) => (
          <button
            key={choice.value}
            type="button"
            role="tab"
            aria-selected={scope === choice.value}
            className={cx(styles.scope, scope === choice.value && styles.scopeOn)}
            onClick={() => {
              setScope(choice.value);
            }}
            lang="sv"
          >
            {choice.label}
          </button>
        ))}
      </div>

      {status === 'loading' && (
        <ul className={styles.list} aria-busy="true" aria-label="Laddar topplistan">
          {Array.from({ length: SKELETON_ROWS }, (_, index) => (
            <li key={index} className={cx(styles.row, styles.skeleton)} aria-hidden="true" />
          ))}
        </ul>
      )}

      {status === 'error' && (
        <p className={styles.empty} role="alert" lang="sv">
          Topplistan gick inte att hämta. Försök igen om en stund.
        </p>
      )}

      {status === 'ready' && rows.length === 0 && (
        <p className={styles.empty} lang="sv">
          Spela en runda för att komma med på listan.
        </p>
      )}

      {status === 'ready' && rows.length > 0 && (
        <ol className={styles.list}>
          {rows.map((row) => (
            <li
              key={`${row.achievedAt}-${row.displayName}-${row.rank}`}
              className={cx(styles.row, row.isMe && styles.me)}
            >
              <span className={styles.rank}>{row.rank}</span>
              <Avatar seed={row.avatarSeed} size={36} />
              <span className={styles.name}>{row.displayName}</span>
              <span className={styles.streak} lang="sv">
                {`${row.bestStreak} i rad`}
              </span>
              <span className={styles.score}>{row.score}</span>
            </li>
          ))}
        </ol>
      )}

      {showFooterRank && (
        <p className={styles.footerRank} lang="sv">
          {`Din bästa placering: ${String(rank)}`}
        </p>
      )}

      <Link to="/decks" className={styles.back} lang="sv">
        Tillbaka till lekarna
      </Link>
    </main>
  );
}
