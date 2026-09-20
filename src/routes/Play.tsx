import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Card } from '../components/Card/Card';
import { AnswerInput } from '../components/AnswerInput/AnswerInput';
import { ScoreStrip } from '../components/ScoreStrip/ScoreStrip';
import { useGameStore } from '../store/useGameStore';
import { getDeck, getEntry } from '../data/decks';
import { cx } from '../utils/cx';
import styles from './Play.module.css';

const DEFAULT_DECK = 'alla';
/** Long enough to read the green pulse, short enough not to feel like waiting. */
const CORRECT_HOLD_MS = 600;
/** A wrong answer holds so the learner reads it, then asks for Continue explicitly. */
const REVEAL_HOLD_MS = 1200;
const SWIPE_MIN_PX = 40;

export function Play() {
  const params = useParams<{ deckId?: string }>();
  const deckId = params.deckId ?? DEFAULT_DECK;

  const status = useGameStore((s) => s.status);
  const currentId = useGameStore((s) => s.currentId);
  const flipped = useGameStore((s) => s.flipped);
  const input = useGameStore((s) => s.input);
  const lastVerdict = useGameStore((s) => s.lastVerdict);
  const streak = useGameStore((s) => s.streak);
  const bestStreakInSession = useGameStore((s) => s.bestStreakInSession);
  const sessionScore = useGameStore((s) => s.sessionScore);
  const answered = useGameStore((s) => s.answered);
  const correct = useGameStore((s) => s.correct);

  const startSession = useGameStore((s) => s.startSession);
  const setInput = useGameStore((s) => s.setInput);
  const submit = useGameStore((s) => s.submit);
  const flip = useGameStore((s) => s.flip);
  const skip = useGameStore((s) => s.skip);
  const continue_ = useGameStore((s) => s.continue_);

  const inputRef = useRef<HTMLInputElement>(null);
  const swiped = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [canContinue, setCanContinue] = useState(false);

  const entry = currentId === null ? undefined : getEntry(currentId);
  const deckName = getDeck(deckId)?.name ?? deckId;
  // The diff compares against the answer that actually matched, not the whole
  // comma-joined list, or every alternative would show up as a difference.
  const answer = lastVerdict?.matched ?? entry?.english[0] ?? '';

  // No cleanup that ends the session: StrictMode remounts this effect, and an
  // unmount must never cost a run. `startSession` banks an abandoned one.
  useEffect(() => {
    startSession(deckId, Date.now());
  }, [deckId, startSession]);

  // A correct answer celebrates briefly and advances itself.
  useEffect(() => {
    if (status !== 'correct') return;
    const timer = setTimeout(() => continue_(Date.now()), CORRECT_HOLD_MS);
    return () => clearTimeout(timer);
  }, [status, continue_]);

  // A revealed answer waits: Continue only appears once the hold is over.
  useEffect(() => {
    if (status !== 'revealed') {
      setCanContinue(false);
      return;
    }
    setCanContinue(false);
    const timer = setTimeout(() => setCanContinue(true), REVEAL_HOLD_MS);
    return () => clearTimeout(timer);
  }, [status]);

  // On a near miss the field keeps focus and selects, so retyping replaces.
  useEffect(() => {
    if (status !== 'close') return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [status]);

  const advance = useCallback(() => {
    continue_(Date.now());
    inputRef.current?.focus();
  }, [continue_]);

  const handleSubmit = () => {
    if (status === 'prompt') {
      submit(Date.now());
      return;
    }
    if (status === 'revealed' && canContinue) advance();
  };

  const handlePointerDown = (event: ReactPointerEvent) => {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  };

  const handlePointerUp = (event: ReactPointerEvent) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // Dominant horizontal axis and real travel, so a tap is never a swipe.
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;

    swiped.current = true;
    if (status === 'revealed' && canContinue) advance();
  };

  const handleFlip = () => {
    if (swiped.current) {
      swiped.current = false;
      return;
    }
    flip();
  };

  if (status === 'done') {
    return (
      <main className={styles.screen}>
        <div className={styles.done}>
          <h1 className={styles.doneTitle} lang="sv">
            Klart!
          </h1>
          <dl className={styles.summary}>
            <div>
              <dt lang="sv">Svarade</dt>
              <dd>{answered}</dd>
            </div>
            <div>
              <dt lang="sv">Rätt</dt>
              <dd>{correct}</dd>
            </div>
            <div>
              <dt lang="sv">Bästa svit</dt>
              <dd>{bestStreakInSession}</dd>
            </div>
            <div>
              <dt lang="sv">Poäng</dt>
              <dd>{sessionScore}</dd>
            </div>
          </dl>
          <Link to="/decks" className={cx(styles.action, styles.primary, styles.doneLink)} lang="sv">
            Välj en annan lek
          </Link>
        </div>
      </main>
    );
  }

  const bandState =
    status === 'close'
      ? styles.shakeSoft
      : status === 'revealed'
        ? styles.shakeHard
        : status === 'correct'
          ? styles.pulse
          : undefined;

  return (
    <main className={styles.screen}>
      <ScoreStrip
        deckName={deckName}
        streak={streak}
        sessionScore={sessionScore}
        bestStreakEver={bestStreakInSession}
      />

      <div
        className={cx(styles.band, bandState)}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {entry && <Card entry={entry} flipped={flipped} onFlip={handleFlip} />}
      </div>

      <AnswerInput
        inputRef={inputRef}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        verdict={lastVerdict?.verdict}
        answer={answer}
        submitted={input}
      />

      {status === 'revealed' ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={cx(styles.action, styles.primary)}
            onClick={advance}
            disabled={!canContinue}
            lang="sv"
          >
            Fortsätt
          </button>
        </div>
      ) : (
        <div className={styles.actions}>
          <button
            type="button"
            className={cx(styles.action, styles.primary)}
            onClick={() => submit(Date.now())}
            lang="sv"
          >
            Kolla
          </button>
          <button type="button" className={styles.action} onClick={flip} lang="sv">
            Vänd
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={() => skip(Date.now())}
            lang="sv"
          >
            Hoppa
          </button>
        </div>
      )}
    </main>
  );
}
