import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderRow } from '../lib/leaderboard';
import type { SessionResult } from '../types/progress';

/**
 * Shared, stable mock functions. Declared with `vi.hoisted` so they survive
 * `vi.resetModules` — the factories below are re-evaluated on every dynamic
 * import, but these references are not, which is what lets a test configure
 * a return value before importing a fresh `scoreStore`.
 */
const remoteMocks = vi.hoisted(() => ({
  constructed: vi.fn(),
  submitSession: vi.fn(),
  topScores: vi.fn(),
  myRank: vi.fn(),
  profile: vi.fn(),
  setProfile: vi.fn(),
  badges: vi.fn(),
}));

const deviceTokenMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  ensureToken: vi.fn(),
}));

vi.mock('./RemoteScoreStore', () => ({
  RemoteScoreStore: class {
    constructor() {
      remoteMocks.constructed();
    }
    submitSession = remoteMocks.submitSession;
    topScores = remoteMocks.topScores;
    myRank = remoteMocks.myRank;
    profile = remoteMocks.profile;
    setProfile = remoteMocks.setProfile;
    badges = remoteMocks.badges;
  },
}));

vi.mock('./deviceToken', () => deviceTokenMocks);

const SESSION: SessionResult = {
  id: 'session-1',
  deckId: 'deck-1',
  startedAt: '2026-09-20T00:00:00.000Z',
  endedAt: '2026-09-20T00:01:00.000Z',
  answered: 5,
  correct: 4,
  bestStreak: 3,
  score: 40,
};

const REMOTE_ROWS: LeaderRow[] = [
  {
    rank: 1,
    displayName: 'Ada',
    avatarSeed: 'ada',
    score: 100,
    bestStreak: 9,
    achievedAt: '2026-09-20T00:00:00.000Z',
    isMe: true,
  },
];

/**
 * `scoreStore.ts` picks between `LocalScoreStore` and `CompositeScoreStore`
 * once, at import time, based on the env flag — so every test that cares
 * about routing needs its own fresh module graph.
 */
async function load(enableRemote: boolean) {
  vi.resetModules();
  vi.stubEnv('VITE_ENABLE_REMOTE', enableRemote ? '1' : '0');
  const storageModule = await import('../store/storage');
  const gameStoreModule = await import('../store/useGameStore');
  const scoreStoreModule = await import('./scoreStore');

  storageModule.resetStorageForTests();
  localStorage.clear();

  return {
    scoreStore: scoreStoreModule.scoreStore,
    useGameStore: gameStoreModule.useGameStore,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('flag off', () => {
  it('never constructs RemoteScoreStore, so remote has zero side effects', async () => {
    const { scoreStore } = await load(false);

    await scoreStore.submitSession(SESSION);
    await scoreStore.topScores('all-time', 10);
    await scoreStore.myRank();

    expect(remoteMocks.constructed).not.toHaveBeenCalled();
    expect(deviceTokenMocks.ensureToken).not.toHaveBeenCalled();
  });
});

describe('CompositeScoreStore.submitSession', () => {
  it('banks the session locally, registers the device, and enqueues remotely', async () => {
    const { scoreStore, useGameStore } = await load(true);

    await scoreStore.submitSession(SESSION);

    expect(useGameStore.getState().sessionHistory).toEqual([SESSION]);
    expect(deviceTokenMocks.ensureToken).toHaveBeenCalled();
    expect(remoteMocks.submitSession).toHaveBeenCalledWith(SESSION);
  });

  it('is idempotent by id locally, even if called twice', async () => {
    const { scoreStore, useGameStore } = await load(true);

    await scoreStore.submitSession(SESSION);
    await scoreStore.submitSession(SESSION);

    expect(useGameStore.getState().sessionHistory).toHaveLength(1);
  });
});

describe('CompositeScoreStore.topScores', () => {
  it('reads local when there is no device token', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue(null);

    const rows = await scoreStore.topScores('all-time', 10);

    expect(remoteMocks.topScores).not.toHaveBeenCalled();
    // Local falls back to the ghost board, never the mocked remote rows.
    expect(rows.some((row) => row.displayName === 'Ada')).toBe(false);
  });

  it('reads remote when a device token exists', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.topScores.mockResolvedValue(REMOTE_ROWS);

    const rows = await scoreStore.topScores('all-time', 10);

    expect(rows).toEqual(REMOTE_ROWS);
  });

  it('falls back to local when the remote read fails', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.topScores.mockRejectedValue(new Error('network down'));

    const rows = await scoreStore.topScores('all-time', 10);

    // The remote store rejected, so this must be the local (ghost) board.
    expect(rows.some((row) => row.displayName === 'Ada')).toBe(false);
  });
});

describe('CompositeScoreStore.myRank', () => {
  it('reads local when there is no device token', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue(null);

    const rank = await scoreStore.myRank();

    expect(remoteMocks.myRank).not.toHaveBeenCalled();
    expect(rank).toBeNull();
  });

  it('reads remote when a device token exists', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.myRank.mockResolvedValue(7);

    await expect(scoreStore.myRank()).resolves.toBe(7);
  });

  it('falls back to local when the remote read fails', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.myRank.mockRejectedValue(new Error('network down'));

    await expect(scoreStore.myRank()).resolves.toBeNull();
  });
});

describe('CompositeScoreStore.profile', () => {
  it('is always local and instant, regardless of a device token', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');

    const profile = await scoreStore.profile();

    expect(remoteMocks.profile).not.toHaveBeenCalled();
    expect(profile.displayName).toBe('Du');
  });
});

describe('CompositeScoreStore.setProfile', () => {
  it('writes local and syncs to remote when a device token exists', async () => {
    const { scoreStore, useGameStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');

    await scoreStore.setProfile({ displayName: 'Ada', avatarSeed: 'ada' });

    expect(useGameStore.getState().profile?.displayName).toBe('Ada');
    expect(remoteMocks.setProfile).toHaveBeenCalledWith({ displayName: 'Ada', avatarSeed: 'ada' });
  });

  it('skips the remote sync when there is no device token', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue(null);

    await scoreStore.setProfile({ displayName: 'Ada', avatarSeed: 'ada' });

    expect(remoteMocks.setProfile).not.toHaveBeenCalled();
  });

  it('swallows a remote failure, since local already has the intent', async () => {
    const { scoreStore, useGameStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.setProfile.mockRejectedValue(new Error('network down'));

    await expect(
      scoreStore.setProfile({ displayName: 'Ada', avatarSeed: 'ada' }),
    ).resolves.toBeUndefined();
    expect(useGameStore.getState().profile?.displayName).toBe('Ada');
  });
});

describe('CompositeScoreStore.badges', () => {
  it('reads local (the persisted fallback) when there is no device token', async () => {
    const { scoreStore, useGameStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue(null);
    useGameStore.setState({ badges: ['first-session'] });

    await expect(scoreStore.badges()).resolves.toEqual([]);
    expect(remoteMocks.badges).not.toHaveBeenCalled();
  });

  it('reads remote when a device token exists', async () => {
    const { scoreStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.badges.mockResolvedValue(['first-session', 'streak-10']);

    await expect(scoreStore.badges()).resolves.toEqual(['first-session', 'streak-10']);
  });

  it('falls back to the store’s persisted fallback when the remote read fails', async () => {
    const { scoreStore, useGameStore } = await load(true);
    deviceTokenMocks.getToken.mockReturnValue('a-token');
    remoteMocks.badges.mockRejectedValue(new Error('network down'));
    useGameStore.setState({ badges: ['first-session'] });

    await expect(scoreStore.badges()).resolves.toEqual(['first-session']);
  });
});
