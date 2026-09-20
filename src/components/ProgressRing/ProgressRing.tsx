import styles from './ProgressRing.module.css';

export interface ProgressRingProps {
  mastered: number;
  total: number;
  size?: number;
}

const BOX = 40;
const RADIUS = 16;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * `mastered / total` as a ring. The number sits inside it, so the ring is
 * decoration and the count is what a screen reader gets.
 */
export function ProgressRing({ mastered, total, size = 40 }: ProgressRingProps) {
  const ratio = total === 0 ? 0 : mastered / total;

  return (
    <div className={styles.ring} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true">
        <circle className={styles.track} cx={20} cy={20} r={RADIUS} />
        <circle
          className={styles.value}
          cx={20}
          cy={20}
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - ratio)}
        />
      </svg>
      <span className={styles.count}>{mastered}</span>
      <span className={styles.sr}>{`${mastered} av ${total} kan du`}</span>
    </div>
  );
}
