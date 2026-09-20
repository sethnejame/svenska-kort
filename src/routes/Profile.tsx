import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Avatar } from '../components/Avatar/Avatar';
import { useGameStore } from '../store/useGameStore';
import { randomSeeds } from '../lib/avatar';
import { cx } from '../utils/cx';
import styles from './Profile.module.css';

const SEED_CHOICES = 6;
const NAME_MIN = 2;
const NAME_MAX = 20;

export function Profile() {
  const profile = useGameStore((s) => s.profile);
  const saveProfile = useGameStore((s) => s.saveProfile);
  const navigate = useNavigate();

  const firstRun = profile === null;

  const [name, setName] = useState(profile?.displayName ?? '');
  // The learner's current seed stays in the row so they can leave it alone.
  const [seeds, setSeeds] = useState(() => {
    const generated = randomSeeds(SEED_CHOICES, Math.random);
    if (profile === null) return generated;
    return [profile.avatarSeed, ...generated.slice(0, SEED_CHOICES - 1)];
  });
  const [seed, setSeed] = useState(profile?.avatarSeed ?? seeds[0] ?? 'kanel');
  const [error, setError] = useState<string | null>(null);

  const shuffle = () => {
    const next = randomSeeds(SEED_CHOICES, Math.random);
    setSeeds(next);
    setSeed(next[0] ?? seed);
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();

    if (trimmed.length < NAME_MIN) {
      setError(`Skriv ett namn på minst ${NAME_MIN} tecken.`);
      return;
    }

    setError(null);
    saveProfile(trimmed, seed, Date.now());
    void navigate('/decks');
  };

  return (
    <main className={styles.screen}>
      <form className={styles.form} onSubmit={handleSubmit} noValidate>
        <h1 className={styles.title} lang="sv">
          {firstRun ? 'Hej! Vem är du?' : 'Din profil'}
        </h1>

        <Avatar seed={seed} size={96} label="Din avatar" />

        <label className={styles.field}>
          <span className={styles.label} lang="sv">
            Visningsnamn
          </span>
          <input
            className={styles.input}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              if (error !== null) setError(null);
            }}
            maxLength={NAME_MAX}
            autoCapitalize="words"
            autoComplete="nickname"
            enterKeyHint="done"
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'profile-name-error'}
          />
        </label>

        <p
          id="profile-name-error"
          className={styles.error}
          role="alert"
          lang="sv"
          hidden={error === null}
        >
          {error}
        </p>

        <fieldset className={styles.seeds}>
          <legend className={styles.label} lang="sv">
            Välj en figur
          </legend>
          <div className={styles.seedRow}>
            {seeds.map((choice) => (
              <button
                key={choice}
                type="button"
                className={cx(styles.seedButton, choice === seed && styles.seedSelected)}
                aria-pressed={choice === seed}
                onClick={() => {
                  setSeed(choice);
                }}
              >
                <Avatar seed={choice} size={48} />
                <span className={styles.srOnly}>{`Figur ${choice}`}</span>
              </button>
            ))}
          </div>
          <button type="button" className={styles.shuffle} onClick={shuffle} lang="sv">
            Blanda om
          </button>
        </fieldset>

        <button type="submit" className={styles.submit} lang="sv">
          {firstRun ? 'Kör igång' : 'Spara'}
        </button>
      </form>
    </main>
  );
}
