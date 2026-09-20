import { useEffect, useRef, useState } from 'react';
import { cx } from '../../utils/cx';
import styles from './ScoreStrip.module.css';

export interface ScoreStripProps {
  deckName: string;
  streak: number;
  sessionScore: number;
  bestStreakEver: number;
}

const FLAME_MIN = 16;
const FLAME_MAX = 28;

/** The flame grows with the streak, then stops so it cannot push the layout around. */
function flameSize(streak: number): number {
  return Math.min(FLAME_MIN + streak, FLAME_MAX);
}

function Flame({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={styles.flame}>
      <path
        d="M12 2c.6 3.4-1.4 4.6-2.8 6.2C7.6 10 6 11.6 6 14.3 6 18 8.9 21 12.4 21S19 18.2 19 14.6c0-3-1.6-5.2-3.2-6.8.2 1.6-.5 2.6-1.4 3-.3-3.6-1.2-6.4-2.4-8.8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function ScoreStrip({ deckName, streak, sessionScore, bestStreakEver }: ScoreStripProps) {
  const previous = useRef(streak);
  const [bump, setBump] = useState(false);

  useEffect(() => {
    const grew = streak > previous.current;
    previous.current = streak;
    setBump(grew);
  }, [streak]);

  return (
    <header className={styles.strip}>
      <span className={styles.deckName} lang="sv">
        {deckName}
      </span>

      <div className={styles.cluster}>
        <div className={styles.streak}>
          <Flame size={flameSize(streak)} />
          <span
            className={cx(styles.streakCount, bump && styles.bump)}
            onAnimationEnd={() => setBump(false)}
          >
            {streak}
          </span>
        </div>
        <span className={styles.score} aria-live="polite">
          {sessionScore} p
        </span>
        <span className={styles.best} lang="sv">
          Bästa svit: {bestStreakEver}
        </span>
      </div>
    </header>
  );
}
