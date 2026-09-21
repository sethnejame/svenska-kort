import { useGameStore } from '../../store/useGameStore';
import styles from './RecoveryBanner.module.css';

/**
 * Shown when the stored blob could not be read and the app started from
 * defaults. The flag is persisted, so this keeps appearing on every screen
 * until the learner acknowledges it.
 */
export function RecoveryBanner() {
  const storageRecovered = useGameStore((s) => s.storageRecovered);
  const dismissRecovery = useGameStore((s) => s.dismissRecovery);

  if (!storageRecovered) return null;

  return (
    <div className={styles.banner} role="status">
      <p className={styles.text} lang="sv">
        Vi kunde inte läsa din tidigare data och började om.
      </p>
      <button type="button" className={styles.action} onClick={dismissRecovery} lang="sv">
        Okej
      </button>
    </div>
  );
}
