/**
 * The network half of `ScoreStore`. Never constructed while
 * `VITE_ENABLE_REMOTE` is off — see `scoreStore.ts` — so importing this file
 * has no effect on the flag-off, byte-identical-to-phase-2 path.
 *
 * Writes go through the outbox and never make the caller wait on the
 * network. Reads talk to the Worker directly; `CompositeScoreStore` is what
 * falls back to local data when they fail, because that fallback decision
 * belongs with the thing that knows a local copy exists at all.
 */
import type { Profile, SessionResult } from '../types/progress';
import type { LeaderRow, Scope } from '../lib/leaderboard';
import type { ScoreStore } from './scoreStore';
import {
  leaderboardResponseSchema,
  meResponseSchema,
  submitSessionResponseSchema,
  type SubmitSessionRequest,
  type SubmitSessionResponse,
} from '../../shared/api';
import { useGameStore } from '../store/useGameStore';
import { apiRequest, type ApiResult } from './apiClient';
import { drain, enqueue, nextDrainAt } from './outbox';

function send(payload: SubmitSessionRequest): Promise<ApiResult<SubmitSessionResponse>> {
  return apiRequest(submitSessionResponseSchema, {
    method: 'POST',
    path: '/api/session',
    body: payload,
  });
}

let timer: ReturnType<typeof setTimeout> | undefined;

async function drainNow(): Promise<void> {
  // Newly-awarded badges are recorded as a side effect of a successful send,
  // so a badge earned by an outbox retry (not just a fresh submit) still
  // reaches the shelf and, if the done screen is still mounted, its burst.
  await drain(send, Date.now(), (ids) => {
    useGameStore.getState().awardBadges(ids);
  });
  scheduleNext();
}

function scheduleNext(): void {
  clearTimeout(timer);
  const at = nextDrainAt();
  if (at === null) return;
  timer = setTimeout(() => void drainNow(), Math.max(0, at - Date.now()));
}

/** Wired once per module load, not once per instance — StrictMode and a stray
 *  second `new RemoteScoreStore()` must not double the 'online' listener. */
let autoDrainStarted = false;

function startAutoDrain(): void {
  if (autoDrainStarted) return;
  autoDrainStarted = true;
  void drainNow();
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => void drainNow());
  }
}

/** Test seam: lets a suite re-arm the listener after resetting the module. */
export function resetAutoDrainForTests(): void {
  autoDrainStarted = false;
  clearTimeout(timer);
  timer = undefined;
}

/** This device's id once `/api/me` has been called once. Not persisted — a
 *  reload is cheap to re-fetch and the id is never needed before that. */
let cachedDeviceId: string | undefined;

async function myDeviceId(): Promise<string | null> {
  if (cachedDeviceId !== undefined) return cachedDeviceId;
  const result = await apiRequest(meResponseSchema, { method: 'GET', path: '/api/me' });
  if (!result.ok) return null;
  cachedDeviceId = result.data.deviceId;
  return cachedDeviceId;
}

export class RemoteScoreStore implements ScoreStore {
  constructor() {
    startAutoDrain();
  }

  submitSession(result: SessionResult): Promise<void> {
    const { answers } = result;
    // Nothing to replay server-side: a session banked before P06, or one
    // pulled in from an imported backup. Neither is ever resubmitted.
    if (answers === undefined) return Promise.resolve();

    // The ratchet `hundred-words` ticks on: only the client holds a per-entry
    // history, so it reports its current distinct-correct total on every
    // submission and the Worker takes the max, never a per-answer delta.
    const distinctCorrect = Object.values(useGameStore.getState().stats).filter(
      (stat) => stat.correct > 0,
    ).length;

    enqueue(
      {
        sessionId: result.id,
        deckId: result.deckId,
        startedAt: result.startedAt,
        endedAt: result.endedAt,
        answers,
        claimedScore: result.score,
        claimedBestStreak: result.bestStreak,
        distinctCorrect,
      },
      Date.now(),
    );
    void drainNow();
    return Promise.resolve();
  }

  async topScores(scope: Scope, limit: number): Promise<LeaderRow[]> {
    const query = new URLSearchParams({ scope, limit: String(limit) });
    const [board, deviceId] = await Promise.all([
      apiRequest(leaderboardResponseSchema, {
        method: 'GET',
        path: `/api/leaderboard?${query.toString()}`,
        auth: false,
      }),
      myDeviceId(),
    ]);
    if (!board.ok) throw new Error(board.message);

    return board.data.rows.map((row) => ({
      rank: row.rank,
      displayName: row.displayName,
      avatarSeed: row.avatarSeed,
      score: row.score,
      bestStreak: row.bestStreak,
      achievedAt: row.achievedAt,
      isMe: row.deviceId === deviceId,
    }));
  }

  async myRank(): Promise<number | null> {
    const result = await apiRequest(meResponseSchema, { method: 'GET', path: '/api/me' });
    if (!result.ok) throw new Error(result.message);
    cachedDeviceId = result.data.deviceId;
    return result.data.rank;
  }

  async profile(): Promise<Profile> {
    const result = await apiRequest(meResponseSchema, { method: 'GET', path: '/api/me' });
    if (!result.ok) throw new Error(result.message);
    cachedDeviceId = result.data.deviceId;
    // A sync side effect, not this call's own purpose: keeps the badge
    // shelf's persisted, offline fallback current on every `/api/me` read.
    useGameStore.getState().awardBadges(result.data.badges);
    return {
      displayName: result.data.displayName,
      avatarSeed: result.data.avatarSeed,
      createdAt: result.data.createdAt,
      totalScore: result.data.totalScore,
      bestStreakEver: result.data.bestStreak,
    };
  }

  async badges(): Promise<string[]> {
    const result = await apiRequest(meResponseSchema, { method: 'GET', path: '/api/me' });
    if (!result.ok) throw new Error(result.message);
    cachedDeviceId = result.data.deviceId;
    useGameStore.getState().awardBadges(result.data.badges);
    return result.data.badges;
  }

  async setProfile(p: Partial<Profile>): Promise<void> {
    // The interface takes a partial because the local store can fill in from
    // what is already saved; the Worker's PUT cannot, so a caller missing
    // either field has nothing complete to send yet.
    if (p.displayName === undefined || p.avatarSeed === undefined) return;
    const result = await apiRequest(meResponseSchema, {
      method: 'PUT',
      path: '/api/me',
      body: { displayName: p.displayName, avatarSeed: p.avatarSeed },
    });
    if (!result.ok) throw new Error(result.message);
  }
}
