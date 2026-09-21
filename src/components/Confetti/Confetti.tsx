import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import styles from './Confetti.module.css';

/** The streaks worth a celebration. */
const MILESTONES = new Set([5, 10, 25]);
const DOT_COUNT = 16;
/** Must outlast the longest keyframe in the stylesheet. */
const BURST_MS = 1100;

const COLORS = [
  'var(--c-accent)',
  'var(--c-correct)',
  'var(--c-primary)',
  'var(--c-swede)',
] as const;

interface Dot {
  dx: number;
  dy: number;
  rotation: number;
  delay: number;
  color: string;
}

/**
 * The global reduced-motion rule collapses every animation to 0.01ms, which
 * would leave these dots sitting on screen at their end state rather than
 * removing them. So the check happens here too, before anything is mounted.
 */
function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function makeDots(): Dot[] {
  return Array.from({ length: DOT_COUNT }, (_, index) => {
    // An even fan with a little jitter, so the burst reads as a burst rather
    // than as a wheel of evenly spaced spokes.
    const angle = (index / DOT_COUNT) * Math.PI * 2 + Math.random() * 0.4;
    const distance = 70 + Math.random() * 90;
    return {
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      rotation: Math.round(Math.random() * 540 - 270),
      delay: Math.round(Math.random() * 120),
      color: COLORS[index % COLORS.length] ?? COLORS[0],
    };
  });
}

export function Confetti({ streak }: { streak: number }) {
  const [dots, setDots] = useState<Dot[] | null>(null);
  const previous = useRef(streak);

  useEffect(() => {
    const was = previous.current;
    previous.current = streak;
    // Arriving at the milestone is what earns the burst. Sitting on it does
    // not, so a re-render at the same streak fires nothing.
    if (streak === was) return;
    if (!MILESTONES.has(streak)) return;
    if (prefersReducedMotion()) return;
    setDots(makeDots());
  }, [streak]);

  useEffect(() => {
    if (dots === null) return;
    const timer = setTimeout(() => {
      setDots(null);
    }, BURST_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [dots]);

  if (dots === null) return null;

  return (
    <div className={styles.field} aria-hidden="true">
      {dots.map((dot, index) => (
        <span
          key={index}
          className={styles.dot}
          style={
            {
              '--dot-color': dot.color,
              '--dot-dx': `${String(Math.round(dot.dx))}px`,
              '--dot-dy': `${String(Math.round(dot.dy))}px`,
              '--dot-rotation': `${String(dot.rotation)}deg`,
              animationDelay: `${String(dot.delay)}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
