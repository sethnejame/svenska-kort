import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BADGE_IDS, BADGE_META, type BadgeId } from '../../../shared/badges';
import { scoreStore } from '../../services/scoreStore';
import { cx } from '../../utils/cx';
import styles from './BadgeShelf.module.css';

interface IconProps {
  className?: string;
}

/** A little shoe print — the first step you take through the door. */
function FootprintIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <ellipse cx={12} cy={15} rx={5} ry={7} />
      <circle cx={9} cy={5} r={1.6} fill="currentColor" stroke="none" />
      <circle cx={12.5} cy={4} r={1.6} fill="currentColor" stroke="none" />
      <circle cx={15.5} cy={5.5} r={1.4} fill="currentColor" stroke="none" />
      <circle cx={17.5} cy={8} r={1.2} fill="currentColor" stroke="none" />
    </svg>
  );
}

/** One flame — a tidy streak. */
function FlameIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2c.6 3.4-1.4 4.6-2.8 6.2C7.6 10 6 11.6 6 14.3 6 18 8.9 21 12.4 21S19 18.2 19 14.6c0-3-1.6-5.2-3.2-6.8.2 1.6-.5 2.6-1.4 3-.3-3.6-1.2-6.4-2.4-8.8Z" />
    </svg>
  );
}

/** Two flames, one bigger — a streak hot enough to spread. */
function DoubleFlameIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M9 2c.4 2.6-1 3.6-2 4.8C5.8 8 5 9.2 5 11c0 2.8 2.1 5 4.9 5S14.8 13.8 14.8 11c0-2.2-1.2-3.9-2.4-5.1.1 1.2-.4 2-1 2.3-.2-2.7-.9-4.8-1.8-6.2Z" />
      <path
        d="M17 9c.3 1.7-.6 2.4-1.3 3.2-.8.8-1.3 1.6-1.3 2.8 0 1.9 1.4 3.3 3.3 3.3S21 16.9 21 15c0-1.5-.8-2.6-1.6-3.4 0 .8-.3 1.3-.7 1.5-.1-1.8-.6-3.2-1.2-4.1Z"
        opacity={0.7}
      />
    </svg>
  );
}

/** A shield with a checkmark — nothing got past you. */
function ShieldCheckIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3l7 3v5c0 5-3.2 8.4-7 10-3.8-1.6-7-5-7-10V6l7-3Z" />
      <path d="M9 12.5l2 2 4-4.5" />
    </svg>
  );
}

/** A bolt — in and out before the clock catches up. */
function BoltIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />
    </svg>
  );
}

/** A calendar with a checkmark — five days, ticked off. */
function CalendarIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x={3.5} y={5} width={17} height={16} rx={3} />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
      <path d="M8 14l2.2 2.2L16 11" />
    </svg>
  );
}

/** A compass — every corner of the map, visited. */
function CompassIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx={12} cy={12} r={9} />
      <path d="M15.5 8.5 13 13l-4.5 2.5L11 11l4.5-2.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** An open book — a hundred words in, and counting. */
function BookIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 6.5c-1.6-1.3-3.6-2-6-2-.6 0-1 .4-1 1v11.5c0 .6.4 1 1 1 2.4 0 4.4.7 6 2 1.6-1.3 3.6-2 6-2 .6 0 1-.4 1-1V5.5c0-.6-.4-1-1-1-2.4 0-4.4.7-6 2Z" />
      <path d="M12 6.5v13" />
    </svg>
  );
}

/** A trophy — a top-ten finish for the week. */
function TrophyIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4Z" />
      <path d="M7 5H4v1a4 4 0 0 0 4 4M17 5h3v1a4 4 0 0 1-4 4" />
      <path d="M12 13v3M9 20h6M9.5 20c0-1.5.7-2.5 2.5-3 1.8.5 2.5 1.5 2.5 3" />
    </svg>
  );
}

/** The little padlock badge on a still-locked tile. */
function LockIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2a4 4 0 0 0-4 4v3H7a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1h-1V6a4 4 0 0 0-4-4Zm-2 7V6a2 2 0 1 1 4 0v3h-4Z" />
    </svg>
  );
}

const ICON_BY_BADGE: Record<BadgeId, (props: IconProps) => ReactElement> = {
  'first-session': FootprintIcon,
  'streak-10': FlameIcon,
  'streak-25': DoubleFlameIcon,
  'perfect-deck': ShieldCheckIcon,
  'speed-demon': BoltIcon,
  'week-warrior': CalendarIcon,
  'all-decks': CompassIcon,
  'hundred-words': BookIcon,
  'top-ten': TrophyIcon,
};

/**
 * Cycles the app's four "good news" tokens across nine badges. `--c-wrong` and
 * `--c-close` stay reserved for grading feedback elsewhere (see `AnswerInput`),
 * so they never color something that's meant to be celebrated.
 */
const ACCENT_CLASSES = [styles.accent0, styles.accent1, styles.accent2, styles.accent3];

/**
 * The full set of badges, in the ticket's fixed order, as tappable medallions —
 * each with its own little icon rather than a wall of text. `scoreStore.badges()`
 * already degrades gracefully (remote when possible, the device's own persisted
 * fallback otherwise), so this component never needs its own retry or error
 * state: a slow or failed read simply shows every badge locked until it resolves.
 *
 * The condition text moves into a per-tile disclosure instead of sitting on the
 * tile permanently: tap (or hover, via the native `title`) to read it. It stays
 * in the DOM at all times, just visually collapsed, so a screen reader always
 * has it via `aria-describedby` — nobody has to tap anything to get the full
 * story.
 */
export function BadgeShelf() {
  const [earned, setEarned] = useState<readonly string[]>([]);
  const [open, setOpen] = useState<ReadonlySet<BadgeId>>(new Set());

  useEffect(() => {
    let cancelled = false;
    scoreStore
      .badges()
      .then((ids) => {
        if (!cancelled) setEarned(ids);
      })
      .catch(() => {
        // Already the empty, all-locked default — nothing more to show.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = (id: BadgeId) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <section className={styles.shelf} aria-labelledby="badge-shelf-heading">
      <h2 className={styles.heading} id="badge-shelf-heading" lang="sv">
        Brickor
      </h2>
      <ul className={styles.grid}>
        {BADGE_IDS.map((id, index) => {
          const isEarned = earned.includes(id);
          const isOpen = open.has(id);
          const meta = BADGE_META[id];
          const Icon = ICON_BY_BADGE[id];
          const descId = `badge-desc-${id}`;

          return (
            <li key={id}>
              <button
                type="button"
                className={cx(
                  styles.tile,
                  isEarned && styles.earned,
                  isEarned && ACCENT_CLASSES[index % ACCENT_CLASSES.length],
                )}
                aria-expanded={isOpen}
                aria-controls={descId}
                aria-describedby={descId}
                aria-label={isEarned ? `${meta.name} (upplåst)` : `${meta.name} (låst)`}
                title={meta.condition}
                onClick={() => {
                  toggle(id);
                }}
              >
                <span className={styles.medallion} aria-hidden="true">
                  <Icon className={styles.icon} />
                  {!isEarned && <LockIcon className={styles.lock} />}
                </span>
                <span className={styles.caption} lang="sv">
                  {isEarned ? meta.name : 'Låst'}
                </span>
              </button>
              <p id={descId} className={cx(styles.desc, !isOpen && styles.descCollapsed)} lang="sv">
                {isEarned ? `Upplåst: ${meta.condition}` : meta.condition}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
