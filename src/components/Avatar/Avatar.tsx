import { avatarLook } from '../../lib/avatar';
import styles from './Avatar.module.css';

export interface AvatarProps {
  seed: string;
  /** Rendered size in pixels. The drawing is a 64-unit square, scaled by CSS. */
  size?: number;
  label?: string;
}

const BOX = 64;

/** The four body outlines, keyed by `look.shape`. */
function body(shape: number) {
  if (shape === 0) return <circle cx={32} cy={32} r={28} />;
  if (shape === 1) return <rect x={5} y={5} width={54} height={54} rx={18} />;
  if (shape === 2) return <path d="M32 4 C52 4 60 16 60 34 C60 52 48 60 32 60 C16 60 4 52 4 34 C4 16 12 4 32 4Z" />;
  return <path d="M32 5 L58 22 L48 56 L16 56 L6 22 Z" />;
}

function eyes(index: number) {
  if (index === 0) {
    return (
      <>
        <circle cx={23} cy={29} r={4} />
        <circle cx={41} cy={29} r={4} />
      </>
    );
  }
  if (index === 1) {
    return (
      <>
        <rect x={19} y={26} width={8} height={7} rx={2} />
        <rect x={37} y={26} width={8} height={7} rx={2} />
      </>
    );
  }
  if (index === 2) {
    return (
      <>
        <path d="M18 30 Q23 24 28 30" fill="none" strokeWidth={3} strokeLinecap="round" />
        <path d="M36 30 Q41 24 46 30" fill="none" strokeWidth={3} strokeLinecap="round" />
      </>
    );
  }
  return (
    <>
      <ellipse cx={23} cy={29} rx={3} ry={5} />
      <ellipse cx={41} cy={29} rx={3} ry={5} />
    </>
  );
}

function mouth(index: number) {
  if (index === 0) {
    return <path d="M23 42 Q32 50 41 42" fill="none" strokeWidth={3} strokeLinecap="round" />;
  }
  if (index === 1) {
    return <path d="M24 44 L40 44" fill="none" strokeWidth={3} strokeLinecap="round" />;
  }
  return <circle cx={32} cy={44} r={4} />;
}

/**
 * A face generated from the seed alone — same seed, same picture, forever.
 *
 * The hue is the one colour in the app that is not a token: an identity colour
 * has to be able to land anywhere on the wheel to stay distinguishable.
 */
export function Avatar({ seed, size = 64, label }: AvatarProps) {
  const look = avatarLook(seed);
  const skin = `hsl(${look.hue} 62% 62%)`;
  const ink = `hsl(${look.hue} 55% 18%)`;

  return (
    <svg
      className={styles.avatar}
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      role={label === undefined ? 'presentation' : 'img'}
      aria-label={label}
      aria-hidden={label === undefined}
    >
      <g fill={skin}>{body(look.shape)}</g>
      <g fill={ink} stroke={ink}>
        {eyes(look.eyes)}
        {mouth(look.mouth)}
      </g>
    </svg>
  );
}
