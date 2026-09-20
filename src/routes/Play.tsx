import { useState } from 'react';
import { Card } from '../components/Card/Card';
import { ALL_ENTRIES } from '../data/decks';
import styles from './Play.module.css';

// Hard-coded preview so the card can be seen. T09 replaces this with the game loop.
const PREVIEW = ALL_ENTRIES[0];

export function Play() {
  const [flipped, setFlipped] = useState(false);

  return (
    <main className={styles.screen}>
      <header className={styles.strip}>
        <span className={styles.deckName}>Alla ord</span>
      </header>

      <div className={styles.band}>
        {PREVIEW && (
          <Card entry={PREVIEW} flipped={flipped} onFlip={() => setFlipped((f) => !f)} />
        )}
      </div>

      <div className={styles.actions}>
        <button type="button" className={`${styles.action} ${styles.primary}`}>
          Kolla
        </button>
        <button type="button" className={styles.action} onClick={() => setFlipped((f) => !f)}>
          Vänd
        </button>
        <button type="button" className={styles.action}>
          Hoppa
        </button>
      </div>
    </main>
  );
}
