import { Link } from 'react-router';
import type { Deck } from '../types/progress';
import { ProgressRing } from '../components/ProgressRing/ProgressRing';
import { Avatar } from '../components/Avatar/Avatar';
import { allDecks, useDeckStore } from '../store/useDeckStore';
import { useGameStore } from '../store/useGameStore';
import { deckProgress } from '../lib/progress';
import { dueCount } from '../lib/leitner';
import { weakestEntries } from '../lib/weakest';
import { entriesForDeck, WEAKEST_DECK } from '../data/decks';
import styles from './Decks.module.css';

export function Decks() {
  const userDecks = useDeckStore((s) => s.userDecks);
  const userEntries = useDeckStore((s) => s.userEntries);
  const selectDeck = useDeckStore((s) => s.selectDeck);
  const stats = useGameStore((s) => s.stats);
  const profile = useGameStore((s) => s.profile);
  const sessionCount = useGameStore((s) => s.sessionCount);

  // The weakest deck is generated, so it has no tile until the learner has
  // missed something. An empty one would only ever say nought of nought.
  const weakest = weakestEntries(entriesForDeck('alla', userEntries), stats);
  const weakestDeck: Deck = {
    ...WEAKEST_DECK,
    source: 'builtin',
    entryIds: weakest.map((entry) => entry.id),
    createdAt: '',
  };

  const decks = [
    ...(weakest.length > 0 ? [weakestDeck] : []),
    ...allDecks(userDecks, userEntries),
  ];
  // Tapping a tile starts the next session, so that is the session the
  // schedule is counted against.
  const nextSession = sessionCount + 1;

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
          const due = dueCount(deck.entryIds, stats, nextSession);
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
                    {due > 0
                      ? `${due} av ${progress.total} ord att öva nu`
                      : `${progress.total} ord · allt repeterat`}
                  </span>
                </div>
                <ProgressRing mastered={progress.mastered} total={progress.total} />
              </Link>
            </li>
          );
        })}
      </ul>

      {userEntries.length === 0 && (
        <p className={styles.empty} lang="sv">
          Du har inga egna ord än. Lekarna ovan är de som följer med appen.
        </p>
      )}

      <Link to="/add" className={styles.addLink} lang="sv">
        Lägg till ord
      </Link>
    </main>
  );
}
