import { Link } from 'react-router';
import { useGameStore } from '../store/useGameStore';
import { accuracyTrend, dayStreak, heatmap, mastery, totals } from '../lib/stats';
import { ALL_ENTRIES } from '../data/decks';
import { cx } from '../utils/cx';
import styles from './Stats.module.css';

/** Monday first, matching the grid the heatmap lays itself out on. */
const WEEKDAYS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

function percent(ratio: number): string {
  return `${String(Math.round(ratio * 100))} %`;
}

/** `2026-09-21` read back as a Swedish date, for a label nobody sees in a grid. */
function readDay(day: string): string {
  const [year, month, date] = day.split('-');
  return `${date ?? ''}/${month ?? ''} ${year ?? ''}`;
}

export function Stats() {
  const sessionHistory = useGameStore((s) => s.sessionHistory);
  const stats = useGameStore((s) => s.stats);
  const bestStreakEver = useGameStore((s) => s.bestStreakEver);
  const totalScore = useGameStore((s) => s.totalScore);

  // Read once per render rather than per helper, so every panel on the screen
  // agrees about what day it is.
  const now = new Date();
  const career = totals(sessionHistory);
  const progress = mastery(stats);
  const days = heatmap(sessionHistory, now);
  const streak = dayStreak(sessionHistory, now);
  const trend = accuracyTrend(sessionHistory);
  const biggestBox = Math.max(...progress.byBox.map((slot) => slot.count), 1);
  const activeDays = days.filter((cell) => cell.answered > 0).length;

  if (career.sessions === 0) {
    return (
      <main className={styles.screen}>
        <h1 className={styles.title} lang="sv">
          Din statistik
        </h1>
        <div className={styles.empty}>
          <p className={styles.emptyText} lang="sv">
            Här dyker din statistik upp när du har spelat en runda.
          </p>
          <Link to="/play/alla" className={styles.emptyAction} lang="sv">
            Spela en runda
          </Link>
        </div>
        <Link to="/decks" className={styles.back} lang="sv">
          Tillbaka till lekarna
        </Link>
      </main>
    );
  }

  return (
    <main className={styles.screen}>
      <h1 className={styles.title} lang="sv">
        Din statistik
      </h1>

      <dl className={styles.figures}>
        <div className={styles.figure}>
          <dt lang="sv">Rätt av svarade</dt>
          <dd>{percent(career.accuracy)}</dd>
        </div>
        <div className={styles.figure}>
          <dt lang="sv">Dagar i rad</dt>
          <dd>{streak}</dd>
        </div>
        <div className={styles.figure}>
          <dt lang="sv">Bästa svit</dt>
          <dd>{bestStreakEver}</dd>
        </div>
        <div className={styles.figure}>
          <dt lang="sv">Poäng totalt</dt>
          <dd>{totalScore}</dd>
        </div>
      </dl>

      <section className={styles.panel} aria-labelledby="stats-mastery">
        <h2 className={styles.panelTitle} id="stats-mastery" lang="sv">
          Ord du kan
        </h2>
        <p className={styles.panelNote} lang="sv">
          {`${String(progress.mastered)} av ${String(progress.started)} påbörjade ord sitter, av ${String(ALL_ENTRIES.length)} i appen.`}
        </p>
        <ol className={styles.boxes}>
          {progress.byBox.map((slot) => (
            <li key={slot.box} className={styles.box}>
              <span
                className={cx(styles.boxBar, slot.box >= 4 && styles.boxBarMastered)}
                style={{ height: `${String((slot.count / biggestBox) * 100)}%` }}
              />
              <span className={styles.boxCount}>{slot.count}</span>
              <span className={styles.boxLabel} lang="sv">
                {`Låda ${String(slot.box)}`}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className={styles.panel} aria-labelledby="stats-trend">
        <h2 className={styles.panelTitle} id="stats-trend" lang="sv">
          Träffsäkerhet per runda
        </h2>
        <ol className={styles.trend}>
          {trend.map((point) => (
            <li
              key={point.id}
              className={styles.trendItem}
              aria-label={`${percent(point.accuracy)} av ${String(point.answered)} ord`}
            >
              {/* Never quite nothing: a zero-height bar reads as a missing run
                  rather than as a run that went badly. */}
              <span
                className={styles.trendBar}
                style={{ height: `${String(Math.max(point.accuracy * 100, 3))}%` }}
              />
            </li>
          ))}
        </ol>
        <p className={styles.panelNote} lang="sv">
          {`De senaste ${String(trend.length)} rundorna, äldst först.`}
        </p>
      </section>

      <section className={styles.panel} aria-labelledby="stats-days">
        <h2 className={styles.panelTitle} id="stats-days" lang="sv">
          Dagar du övat
        </h2>
        {/* Eighty-odd cells read aloud one by one would be unusable, so the grid
            is decorative and the note below carries the same fact in words. */}
        <div className={styles.calendar} aria-hidden="true">
          <div className={styles.weekdays}>
            {WEEKDAYS.map((letter, index) => (
              <span key={index}>{letter}</span>
            ))}
          </div>
          <div className={styles.heatmap}>
            {days.map((cell) => (
              <span
                key={cell.day}
                className={styles.day}
                data-level={cell.level}
                title={
                  cell.answered === 0
                    ? readDay(cell.day)
                    : `${readDay(cell.day)}: ${String(cell.answered)} ord`
                }
              />
            ))}
          </div>
        </div>
        <p className={styles.panelNote} lang="sv">
          {`${String(activeDays)} dagar av de senaste ${String(days.length)}.`}
        </p>
      </section>

      <Link to="/decks" className={styles.back} lang="sv">
        Tillbaka till lekarna
      </Link>
    </main>
  );
}
