import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link, useParams } from 'react-router';
import { Card } from '../components/Card/Card';
import { AnswerInput } from '../components/AnswerInput/AnswerInput';
import { SpecialChars } from '../components/SpecialChars/SpecialChars';
import { ScoreStrip } from '../components/ScoreStrip/ScoreStrip';
import { Confetti } from '../components/Confetti/Confetti';
import { useGameStore } from '../store/useGameStore';
import { useDeckStore } from '../store/useDeckStore';
import { useSpeak } from '../hooks/useSpeak';
import { useDictation } from '../hooks/useDictation';
import { deckDisplayName, getEntry } from '../data/decks';
import { scoreStore } from '../services/scoreStore';
import { BADGE_META, type BadgeId } from '../../shared/badges';
import { cx } from '../utils/cx';
import styles from './Play.module.css';

const DEFAULT_DECK = 'alla';
/** Long enough to read the green pulse, short enough not to feel like waiting. */
const CORRECT_HOLD_MS = 600;
/** A wrong answer holds so the learner reads it, then asks for Continue explicitly. */
const REVEAL_HOLD_MS = 1200;
const SWIPE_MIN_PX = 40;
/** One of `Confetti`'s own milestones — the smallest, so a single badge burst
 *  reads the same as a first in-session streak burst. */
const BADGE_BURST_STREAK = 5;
/** Must outlast `Confetti`'s own burst so the reset never clips the animation. */
const BADGE_BURST_RESET_MS = 1200;

/** `celebrateBadges` holds ids the Worker already validated against `BadgeId`,
 *  so this is a lookup on trusted server data, not on parsed user input. */
function badgeName(id: string): string {
  return BADGE_META[id as BadgeId].name;
}

function SpeakerIcon() {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 7.5h2.5L10 4.5v11L6.5 12.5H4z" />
      <path d="M13 7.5a3.5 3.5 0 0 1 0 5M15.5 5a7 7 0 0 1 0 10" />
    </svg>
  );
}

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
  const reverse = useGameStore((s) => s.reverse);

  const startSession = useGameStore((s) => s.startSession);
  const setInput = useGameStore((s) => s.setInput);
  const submit = useGameStore((s) => s.submit);
  const flip = useGameStore((s) => s.flip);
  const skip = useGameStore((s) => s.skip);
  const continue_ = useGameStore((s) => s.continue_);

  const celebrateBadges = useGameStore((s) => s.celebrateBadges);
  const clearCelebration = useGameStore((s) => s.clearCelebration);

  const inputRef = useRef<HTMLInputElement>(null);
  const swiped = useRef(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [canContinue, setCanContinue] = useState(false);
  const [shownBadges, setShownBadges] = useState<string[]>([]);
  const [badgeBurst, setBadgeBurst] = useState(0);

  const userEntries = useDeckStore((s) => s.userEntries);
  const sessionHistory = useGameStore((s) => s.sessionHistory);

  const entry = currentId === null ? undefined : getEntry(currentId, userEntries);
  const deckName = deckDisplayName(deckId);
  // The diff compares against the answer that actually matched, not the whole
  // comma-joined list, or every alternative would show up as a difference.
  const expected = reverse ? entry?.swedish : entry?.english[0];
  const answer = lastVerdict?.matched ?? expected ?? '';

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

  // The run is already banked locally; this is what a remote board would need.
  const lastSession = status === 'done' ? sessionHistory.at(-1) : undefined;
  const lastSessionId = lastSession?.id;
  useEffect(() => {
    if (lastSession === undefined) return;
    void scoreStore.submitSession(lastSession);
    // Keyed on the id so a re-render cannot submit the same run twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSessionId]);

  // Best-effort: only fires if the outbox drain resolves while this screen is
  // still mounted. `clearCelebration` empties the store's queue right away, so
  // a later screen never re-shows the same badge — the local snapshot below is
  // what the done screen actually renders.
  useEffect(() => {
    if (celebrateBadges.length === 0) return;
    setShownBadges(celebrateBadges);
    setBadgeBurst(BADGE_BURST_STREAK);
    clearCelebration();
  }, [celebrateBadges, clearCelebration]);

  // Mirrors the in-play burst: jump to the milestone, then fall back off it so
  // a later celebration in the same session can fire again.
  useEffect(() => {
    if (badgeBurst === 0) return;
    const timer = setTimeout(() => setBadgeBurst(0), BADGE_BURST_RESET_MS);
    return () => clearTimeout(timer);
  }, [badgeBurst]);

  const { supported: canSpeak, speak } = useSpeak();
  // In reverse the Swedish is the answer, so hearing it before the card turns
  // would simply read the answer out.
  const canHear = !reverse || flipped;

  const handleTranscript = useCallback(
    (transcript: string) => {
      setInput(transcript);
    },
    [setInput],
  );

  const dictation = useDictation({
    // The learner speaks whatever the field is asking them to type.
    lang: reverse ? 'sv-SE' : 'en-US',
    onResult: handleTranscript,
  });

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

          {shownBadges.length > 0 && (
            <p className={styles.badgeLine} lang="sv">
              Ny bricka: {shownBadges.map(badgeName).join(', ')}
            </p>
          )}
          <Confetti streak={badgeBurst} />

          <Link
            to="/leaderboard"
            className={cx(styles.action, styles.primary, styles.doneLink)}
            lang="sv"
          >
            Se topplistan
          </Link>
          <Link to="/decks" className={cx(styles.action, styles.doneLink)} lang="sv">
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

      <Confetti streak={streak} />

      <div
        className={cx(styles.band, bandState)}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
      >
        {entry && (
          <Card entry={entry} flipped={flipped} onFlip={handleFlip} reverse={reverse} />
        )}
        {entry && canSpeak && canHear && (
          <button
            type="button"
            className={styles.speak}
            onClick={() => {
              speak(entry.swedish);
            }}
            aria-label={`Hör ${entry.swedish}`}
          >
            <SpeakerIcon />
          </button>
        )}
      </div>

      <AnswerInput
        inputRef={inputRef}
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        verdict={lastVerdict?.verdict}
        answer={answer}
        submitted={input}
        reverse={reverse}
        {...(dictation.supported && {
          onDictate: dictation.listening ? dictation.stop : dictation.start,
          listening: dictation.listening,
        })}
      />

      {reverse && status === 'prompt' && <SpecialChars />}

      {dictation.error !== null && (
        <p className={styles.speechError} role="alert" lang="sv">
          Rösten gick inte att läsa: {dictation.error}
        </p>
      )}

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
