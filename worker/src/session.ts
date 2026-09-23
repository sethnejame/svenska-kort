/**
 * Session submission.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * The client is trusted about *what happened*, and never trusted about *what
 * that is worth*. The Worker replays the reported answers through
 * `shared/scoring.ts` — the same file the client scored them with — so the two
 * arithmetics cannot drift, and the client's own total is stored in its own
 * column as a claim rather than as the score.
 *
 * What the Worker cannot do is check whether the answers were actually correct.
 * Grading needs the learner's deck, and user entries live on the device; posting
 * them here would cost a read per answer and is exactly the per-answer traffic
 * the whole schema is shaped to avoid. So a determined attacker can submit a
 * session of invented correct answers and it will price correctly. That is
 * accepted: this is a vocabulary app, the leaderboard is not worth money, and
 * the cost of tightening further is rejecting honest fast learners.
 *
 * Which is why every plausibility check below sets a flag instead of refusing.
 * A flagged session is stored, counts for the learner's own stats, and is only
 * held out of the leaderboard. The learner is never told. A false positive
 * costs them a leaderboard row; a false rejection would cost them the session
 * they just spent ten minutes on.
 */
import type { SubmitSessionRequest, SubmitSessionResponse } from '../../shared/api';
import {
  ALL_DECK_TOPIC_IDS,
  hasAllDecks,
  hasHundredWords,
  hasWeekWarrior,
  isFirstSession,
  isPerfectDeck,
  isSpeedDemon,
  isStreak10,
  isStreak25,
  type BadgeId,
} from '../../shared/badges';
import { packAnswers, replaySession } from '../../shared/scoring';
import { seasonIdFor } from '../../shared/season';
import type { Device } from './auth';

/** Why a session is held off the leaderboard. Stored as a JSON array, null when clean. */
export type SessionFlag =
  | 'fast-rate'
  | 'short-session'
  | 'score-mismatch'
  | 'timing-inconsistent'
  | 'impossible-timing';

/** The ceiling both rate checks are calibrated against: 3 answers a second. */
const MAX_ANSWERS_PER_SECOND = 3;
const MIN_MS_PER_ANSWER = 1000 / MAX_ANSWERS_PER_SECOND;

const RATE_WINDOW = 10;
const RATE_WINDOW_MIN_MS = RATE_WINDOW * MIN_MS_PER_ANSWER;

const MIN_PLAUSIBLE_ELAPSED_MS = 250;
/** Timings may exceed the wall clock by a little; clocks and render gaps are real. */
const TIMING_SLACK = 1.1;

/** How far ahead of the server a client's clock may be before the payload is refused. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The fastest ten-answer stretch anywhere in the session.
 *
 * A window rather than a session average, because averaging lets a scripted
 * burst hide behind a long tail of ordinary answers.
 */
function fastestWindowMs(answers: readonly { elapsedMs: number }[]): number | null {
  if (answers.length < RATE_WINDOW) return null;

  // Summed per window rather than rolled, so there is no indexed lookup to
  // guard and no unreachable fallback branch. At ten answers a window and 500 a
  // session that is 5,000 additions, which does not register against 10 ms.
  const times = answers.map((answer) => answer.elapsedMs);
  const windowFrom = (start: number) =>
    times.slice(start, start + RATE_WINDOW).reduce((total, ms) => total + ms, 0);

  let fastest = windowFrom(0);
  for (let start = 1; start + RATE_WINDOW <= times.length; start += 1) {
    const window = windowFrom(start);
    if (window < fastest) fastest = window;
  }
  return fastest;
}

export function flagsFor(body: SubmitSessionRequest, computedScore: number): SessionFlag[] {
  const flags: SessionFlag[] = [];
  const { answers } = body;

  const fastest = fastestWindowMs(answers);
  if (fastest !== null && fastest < RATE_WINDOW_MIN_MS) flags.push('fast-rate');

  // The whole-session counterpart of the window check, and the only rate signal
  // that works on a session of fewer than ten answers. It reads the wall clock
  // rather than the reported timings, so padding `elapsedMs` does not hide it.
  //
  // The ticket specified 2 seconds per answer here. That is the one number in
  // this file that was wrong: it flags every learner averaging faster than one
  // answer every two seconds, which is most of them, and it contradicts the
  // ticket's own requirement that 2.5 answers a second be accepted unflagged.
  // Calibrated against the same 3-per-second ceiling instead, the two checks
  // agree and an honest fast learner keeps their leaderboard row.
  const durationMs = Date.parse(body.endedAt) - Date.parse(body.startedAt);
  if (answers.length > 0 && durationMs < MIN_MS_PER_ANSWER * answers.length) {
    flags.push('short-session');
  }

  if (body.claimedScore !== computedScore) flags.push('score-mismatch');

  const reported = answers.reduce((sum, answer) => sum + answer.elapsedMs, 0);
  if (reported > durationMs * TIMING_SLACK) flags.push('timing-inconsistent');

  if (answers.some((answer) => answer.elapsedMs < MIN_PLAUSIBLE_ELAPSED_MS)) {
    flags.push('impossible-timing');
  }

  return flags;
}

export interface SessionDeps {
  db: D1Database;
  now: number;
}

/**
 * Stores the session and credits the device, or returns what was stored before.
 *
 * Two rows written per session, once. A per-answer table would have put the
 * daily ceiling at 1,408 sessions instead of 50,000, which is the single
 * largest design decision in the schema.
 */
export async function submitSession(
  body: SubmitSessionRequest,
  device: Device,
  deps: SessionDeps,
): Promise<SubmitSessionResponse> {
  const totals = replaySession(body.answers);
  const flags = flagsFor(body, totals.score);
  const createdAt = new Date(deps.now).toISOString();

  // Credited BEFORE the session is stored, and guarded on it not being stored
  // yet. That ordering is the whole idempotency mechanism: on a replay the row
  // already exists, `NOT EXISTS` is false, and the credit is skipped.
  //
  // An earlier version guarded on the stored `created_at` matching this
  // request's, which collides whenever a retry lands in the same millisecond —
  // and a fragile guard here means a double-credited score that nothing ever
  // corrects. This version involves no clock at all.
  // `best_score` feeds histogram rank, so a flagged session must not reach it —
  // binding 0 leaves `MAX` with the existing value. `total_score` and
  // `best_streak` are credited either way, because those are the learner's own
  // stats and a flag only holds a session off the leaderboard.
  const leaderboardScore = flags.length > 0 ? 0 : totals.score;

  // Badge state, derived from the device row fetched before this request's own
  // update and from this session's own numbers — never a query, so this adds
  // nothing to the round trip. `week-warrior` and `all-decks` are ratchets on
  // `device` (see 0001/0004); the rest are pure functions of `totals`/`body`.
  const hadNoPriorSessions = device.decks_played === '[]';
  const decksPlayed: string[] = JSON.parse(device.decks_played) as string[];
  const isTopicDeck = (ALL_DECK_TOPIC_IDS as readonly string[]).includes(body.deckId);
  const newDecksPlayed =
    isTopicDeck && !decksPlayed.includes(body.deckId) ? [...decksPlayed, body.deckId] : decksPlayed;

  const season = seasonIdFor(deps.now);
  const seasonDays: string[] =
    device.season_id_days === season ? (JSON.parse(device.season_days) as string[]) : [];
  const today = createdAt.slice(0, 10);
  const newSeasonDays = seasonDays.includes(today) ? seasonDays : [...seasonDays, today];

  const badgeChecks: ReadonlyArray<[BadgeId, boolean]> = [
    ['first-session', isFirstSession(hadNoPriorSessions)],
    ['streak-10', isStreak10(totals.bestStreak)],
    ['streak-25', isStreak25(totals.bestStreak)],
    ['perfect-deck', isPerfectDeck(totals.answered, totals.correct)],
    ['speed-demon', isSpeedDemon(body.answers)],
    ['week-warrior', hasWeekWarrior(newSeasonDays.length)],
    ['all-decks', hasAllDecks(newDecksPlayed)],
    ['hundred-words', hasHundredWords(body.distinctCorrect)],
  ];
  const earnedBadgeIds = badgeChecks.filter(([, earned]) => earned).map(([id]) => id);

  const credit = deps.db
    .prepare(
      `UPDATE device
          SET total_score = total_score + ?,
              best_streak = MAX(best_streak, ?),
              best_score  = MAX(best_score, ?),
              distinct_correct = MAX(distinct_correct, ?),
              decks_played = ?,
              season_id_days = ?,
              season_days = ?
        WHERE id = ?
          AND NOT EXISTS (SELECT 1 FROM session WHERE id = ?)`,
    )
    .bind(
      totals.score,
      totals.bestStreak,
      leaderboardScore,
      body.distinctCorrect,
      JSON.stringify(newDecksPlayed),
      season,
      JSON.stringify(newSeasonDays),
      device.id,
      body.sessionId,
    );

  const insert = deps.db
    .prepare(
      `INSERT INTO session (id, device_id, deck_id, season_id, started_at, ended_at,
                            answered, correct, best_streak, score, claimed_score,
                            timings, flags, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING
       RETURNING id`,
    )
    .bind(
      body.sessionId,
      device.id,
      body.deckId,
      season,
      body.startedAt,
      body.endedAt,
      totals.answered,
      totals.correct,
      totals.bestStreak,
      totals.score,
      body.claimedScore,
      JSON.stringify(packAnswers(body.answers)),
      flags.length > 0 ? JSON.stringify(flags) : null,
      createdAt,
    );

  // A badge_award insert per predicate that came out true, appended to the same
  // batch as the credit and the session row — still one transaction, one round
  // trip. The composite PK's `ON CONFLICT DO NOTHING` makes each one safe to
  // attempt even on a retry that re-evaluates the same predicate true; only a
  // genuinely new row comes back from `RETURNING`.
  const badgeInserts = earnedBadgeIds.map((badgeId) =>
    deps.db
      .prepare(
        `INSERT INTO badge_award (device_id, badge_id, season_id, awarded_at)
         VALUES (?, ?, '', ?)
         ON CONFLICT DO NOTHING
         RETURNING badge_id`,
      )
      .bind(device.id, badgeId, createdAt),
  );

  // One batch is one D1 transaction and one round trip, so either every row is
  // written or none is. A session stored without its credit would be a score
  // the learner earned and never received, and no later request would fix it.
  const results = await deps.db.batch<{ id: string } | { badge_id: BadgeId }>([
    credit,
    insert,
    ...badgeInserts,
  ]);
  // The array's shape is fixed by the call above: index 0 is always the
  // credit UPDATE (no RETURNING), index 1 is always the session INSERT, and
  // everything after is one row per badge insert, in order. `noUncheckedIndexedAccess`
  // cannot see that invariant, so it is asserted once here rather than
  // threaded through as `| undefined` on every access below.
  const [insertResult] = results.slice(1, 2) as [D1Result<{ id: string }>];
  const badgeResults = results.slice(2) as D1Result<{ badge_id: BadgeId }>[];

  if (insertResult.results.length > 0) {
    const awardedIds = new Set(badgeResults.flatMap((r) => r.results.map((row) => row.badge_id)));
    const badges = earnedBadgeIds.filter((id) => awardedIds.has(id));
    return {
      sessionId: body.sessionId,
      ...totals,
      totalScore: device.total_score + totals.score,
      // P05 fills this from the histogram.
      rank: null,
      badges,
    };
  }

  return replayOf(body.sessionId, device, deps);
}

/**
 * The response for a session that was already stored.
 *
 * The outbox retries without knowing whether the first attempt landed, so a
 * duplicate has to be a success carrying the same numbers — not a 409, which
 * the client would have no useful way to handle.
 */
async function replayOf(
  sessionId: string,
  device: Device,
  deps: SessionDeps,
): Promise<SubmitSessionResponse> {
  const row = await deps.db
    .prepare(
      `SELECT s.answered, s.correct, s.best_streak, s.score, d.total_score
         FROM session s JOIN device d ON d.id = s.device_id
        WHERE s.id = ? AND s.device_id = ?
        LIMIT 1`,
    )
    .bind(sessionId, device.id)
    // Scoped to the device as well as the id: a session id is client-chosen, and
    // without this a guessed id would read another learner's session back.
    .first<{
      answered: number;
      correct: number;
      best_streak: number;
      score: number;
      total_score: number;
    }>();

  // The id belongs to somebody else's session, so it is not this device's to
  // read and not this device's to overwrite. Reported as stored-and-unchanged
  // with nothing in it, which tells the client to stop retrying without
  // confirming that the id exists.
  if (row === null) {
    return {
      sessionId,
      score: 0,
      answered: 0,
      correct: 0,
      bestStreak: 0,
      totalScore: device.total_score,
      rank: null,
      badges: [],
    };
  }

  return {
    sessionId,
    score: row.score,
    answered: row.answered,
    correct: row.correct,
    bestStreak: row.best_streak,
    totalScore: row.total_score,
    rank: null,
    // A replay is never "new news" — the badges, if any, were already reported
    // on the attempt that first stored this session.
    badges: [],
  };
}
