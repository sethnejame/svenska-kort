import type { Profile, SessionResult } from '../types/progress';
import type { Ghost, LeaderRow, Scope } from '../lib/leaderboard';
import { ghostRows, myRank, rankRows, sessionRows } from '../lib/leaderboard';
import { useGameStore } from '../store/useGameStore';
import { ensureToken, getToken } from './deviceToken';
import { RemoteScoreStore } from './RemoteScoreStore';
import ghostData from '../data/ghosts.json';

export type { LeaderRow, Scope } from '../lib/leaderboard';

/**
 * Every method is async even though the local implementation resolves
 * immediately. That is the whole point of this file: when phase 3 puts the
 * board behind a network, only the instance below changes.
 */
export interface ScoreStore {
  submitSession(result: SessionResult): Promise<void>;
  topScores(scope: Scope, limit: number): Promise<LeaderRow[]>;
  myRank(): Promise<number | null>;
  profile(): Promise<Profile>;
  setProfile(p: Partial<Profile>): Promise<void>;
  /** Every badge id this device has ever earned, for the badge shelf. */
  badges(): Promise<string[]>;
}

const GHOSTS: Ghost[] = ghostData;

/** Someone who has played but never filled in the profile form. */
function anonymous(now: number): Profile {
  return {
    displayName: 'Du',
    avatarSeed: 'du',
    createdAt: new Date(now).toISOString(),
    totalScore: 0,
    bestStreakEver: 0,
  };
}

class LocalScoreStore implements ScoreStore {
  constructor(private readonly now: () => number = Date.now) {}

  private board(scope: Scope): LeaderRow[] {
    const { sessionHistory, profile } = useGameStore.getState();
    const at = this.now();
    return rankRows(
      [...sessionRows(sessionHistory, profile), ...ghostRows(GHOSTS, at)],
      scope,
      at,
    );
  }

  submitSession(result: SessionResult): Promise<void> {
    // The game store banked this when the session ended, so locally there is
    // nothing to send. The call exists so the remote store has a hook, and it
    // stays idempotent by id so calling it twice cannot double a run.
    const { sessionHistory } = useGameStore.getState();
    if (!sessionHistory.some((session) => session.id === result.id)) {
      useGameStore.setState({ sessionHistory: [...sessionHistory, result] });
    }
    return Promise.resolve();
  }

  topScores(scope: Scope, limit: number): Promise<LeaderRow[]> {
    return Promise.resolve(this.board(scope).slice(0, limit));
  }

  myRank(): Promise<number | null> {
    return Promise.resolve(myRank(this.board('all-time')));
  }

  profile(): Promise<Profile> {
    const { profile, totalScore, bestStreakEver } = useGameStore.getState();
    if (profile === null) return Promise.resolve(anonymous(this.now()));
    // The store stays authoritative for the career numbers; the snapshot on
    // the profile object is written at save time and can be stale.
    return Promise.resolve({ ...profile, totalScore, bestStreakEver });
  }

  setProfile(p: Partial<Profile>): Promise<void> {
    const state = useGameStore.getState();
    const current = state.profile;
    state.saveProfile(
      p.displayName ?? current?.displayName ?? '',
      p.avatarSeed ?? current?.avatarSeed ?? 'du',
      this.now(),
    );
    return Promise.resolve();
  }

  badges(): Promise<string[]> {
    // Phase 2 has no server-confirmed badges to show.
    return Promise.resolve([]);
  }
}

/**
 * Routes between local and remote. Every method keeps the local store
 * authoritative for this device's own history — a remote read only replaces
 * what is shown, never what is banked — so a failed network call degrades to
 * exactly the phase-2 experience rather than an error screen.
 */
class CompositeScoreStore implements ScoreStore {
  private readonly local: LocalScoreStore;
  private readonly remote: RemoteScoreStore;

  constructor(now?: () => number) {
    this.local = new LocalScoreStore(now);
    this.remote = new RemoteScoreStore();
  }

  async submitSession(result: SessionResult): Promise<void> {
    // The store already banked this locally when the session ended; this
    // call is idempotent by id, same as the local-only path.
    await this.local.submitSession(result);
    // The first submission is the moment this device registers — mirroring
    // the Worker's own first-sight-registers model — so nothing here needs a
    // separate signup step.
    ensureToken();
    // Never awaited for its own sake: the outbox is the promise that this
    // eventually reaches the server, not this call.
    void this.remote.submitSession(result);
  }

  async topScores(scope: Scope, limit: number): Promise<LeaderRow[]> {
    if (getToken() === null) return this.local.topScores(scope, limit);
    try {
      return await this.remote.topScores(scope, limit);
    } catch {
      return this.local.topScores(scope, limit);
    }
  }

  async myRank(): Promise<number | null> {
    if (getToken() === null) return this.local.myRank();
    try {
      return await this.remote.myRank();
    } catch {
      return this.local.myRank();
    }
  }

  profile(): Promise<Profile> {
    // Instant: the profile screen must never wait on the network to render
    // what is already on the device.
    return this.local.profile();
  }

  async setProfile(p: Partial<Profile>): Promise<void> {
    await this.local.setProfile(p);
    if (getToken() === null) return;
    const profile = await this.local.profile();
    try {
      await this.remote.setProfile({ displayName: profile.displayName, avatarSeed: profile.avatarSeed });
    } catch {
      // The outbox has no place for a profile edit; the next successful read
      // or edit reconciles it. Local already has the learner's intent.
    }
  }

  async badges(): Promise<string[]> {
    if (getToken() === null) return this.local.badges();
    try {
      // A successful call already syncs `useGameStore`'s persisted fallback
      // as a side effect (see `RemoteScoreStore.badges()`); this is simply
      // the freshest answer on top of that.
      return await this.remote.badges();
    } catch {
      return useGameStore.getState().badges;
    }
  }
}

const ENABLE_REMOTE = import.meta.env.VITE_ENABLE_REMOTE === '1';

/**
 * The only export components use, and deliberately typed as the interface so
 * nothing can reach for a local-only or remote-only detail.
 *
 * With the flag off this is exactly the phase-2 line: `RemoteScoreStore` is
 * never constructed, so it has no side effects — no outbox drain, no
 * 'online' listener, no network call ever fires.
 */
export const scoreStore: ScoreStore = ENABLE_REMOTE ? new CompositeScoreStore() : new LocalScoreStore();
