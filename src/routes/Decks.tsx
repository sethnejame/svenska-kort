import { Link } from 'react-router';
import { ProgressRing } from '../components/ProgressRing/ProgressRing';
import { Avatar } from '../components/Avatar/Avatar';
import { allDecks, useDeckStore } from '../store/useDeckStore';
import { useGameStore } from '../store/useGameStore';
import { deckProgress } from '../lib/progress';
import styles from './Decks.module.css';

export function Decks() {
  const userDecks = useDeckStore((s) => s.userDecks);
  const userEntries = useDeckStore((s) => s.userEntries);
  const selectDeck = useDeckStore((s) => s.selectDeck);
  const stats = useGameStore((s) => s.stats);
  const profile = useGameStore((s) => s.profile);

  const decks = allDecks(userDecks, userEntries);

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <h1 className={styles.title} lang="sv">
          Välj en lek
        </h1>
        {profile && (
          <Link to="/profile" className={styles.profileLink}>
            <Avatar seed={profile.avatarSeed} size={40} />
            <span className={styles.srOnly}>{`Profil: ${profile.displayName}`}</span>
          </Link>
        )}
      </header>

      <ul className={styles.grid}>
        {decks.map((deck) => {
          const progress = deckProgress(deck.entryIds, stats);
          return (
            <li key={deck.id}>
              <Link
                to={`/play/${deck.id}`}
                className={styles.tile}
                onClick={() => {
                  selectDeck(deck.id);
                }}
              >
                <div className={styles.tileText}>
                  <span className={styles.deckName} lang="sv">
                    {deck.name}
                  </span>
                  <span className={styles.deckDescription}>{deck.description}</span>
                  <span className={styles.deckCount} lang="sv">
                    {`${progress.total} ord`}
                  </span>
                </div>
                <ProgressRing mastered={progress.mastered} total={progress.total} />
              </Link>
            </li>
          );
        })}
      </ul>

      <Link to="/add" className={styles.addLink} lang="sv">
        Lägg till ord
      </Link>
    </main>
  );
}
