import type { Profile, SessionResult } from '../types/progress';
import type { Ghost, LeaderRow, Scope } from '../lib/leaderboard';
import { ghostRows, myRank, rankRows, sessionRows } from '../lib/leaderboard';
import { useGameStore } from '../store/useGameStore';
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
}

/**
 * The only export components use, and deliberately typed as the interface so
 * nothing can reach for a local-only detail.
 */
export const scoreStore: ScoreStore = new LocalScoreStore();
