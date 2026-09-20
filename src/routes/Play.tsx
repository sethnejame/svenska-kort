import styles from './Play.module.css';

export function Play() {
  return (
    <main className={styles.screen}>
      <header className={styles.strip}>
        <span className={styles.deckName}>Alla ord</span>
      </header>

      <div className={styles.band}>
        <div className={styles.cardSlot}>Kortet kommer snart</div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={`${styles.action} ${styles.primary}`}>
          Kolla
        </button>
        <button type="button" className={styles.action}>
          Vänd
        </button>
        <button type="button" className={styles.action}>
          Hoppa
        </button>
      </div>
    </main>
  );
}
