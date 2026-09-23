import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteScoreStore as RemoteScoreStoreType } from './RemoteScoreStore';
import type { ApiResult } from './apiClient';
import type { SessionResult } from '../types/progress';

vi.mock('./apiClient', () => ({ apiRequest: vi.fn() }));
vi.mock('./outbox', () => ({
  enqueue: vi.fn(),
  drain: vi.fn(),
  nextDrainAt: vi.fn(),
}));

const DEVICE_ID = 'device-1';

const ME_RESPONSE = {
  deviceId: DEVICE_ID,
  displayName: 'Ada',
  avatarSeed: 'ada',
  isAdmin: false,
  createdAt: '2026-09-20T00:00:00.000Z',
  totalScore: 120,
  bestStreak: 9,
  rank: 3,
  badges: [],
};

const LEADERBOARD_RESPONSE = {
  scope: 'all-time' as const,
  seasonId: '',
  ageSeconds: 12,
  rows: [
    {
      rank: 1,
      deviceId: DEVICE_ID,
      displayName: 'Ada',
      avatarSeed: 'ada',
      score: 100,
      bestStreak: 9,
      achievedAt: '2026-09-20T00:00:00.000Z',
    },
    {
      rank: 2,
      deviceId: 'someone-else',
      displayName: 'Bo',
      avatarSeed: 'bo',
      score: 80,
      bestStreak: 5,
      achievedAt: '2026-09-19T00:00:00.000Z',
    },
  ],
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function fail<T>(status: number | null, message = 'fail'): ApiResult<T> {
  return { ok: false, status, message };
}

const SESSION_WITH_ANSWERS: SessionResult = {
  id: 'session-1',
  deckId: 'deck-1',
  startedAt: '2026-09-20T00:00:00.000Z',
  endedAt: '2026-09-20T00:01:00.000Z',
  answered: 1,
  correct: 1,
  bestStreak: 1,
  score: 10,
  answers: [
    { entryId: 'hej-phrase', verdict: 'correct', elapsedMs: 500, wasTyped: true, acceptedOnRetry: false },
  ],
};

const SESSION_WITHOUT_ANSWERS: SessionResult = {
  id: 'session-2',
  deckId: 'deck-1',
  startedAt: '2026-09-20T00:00:00.000Z',
  endedAt: '2026-09-20T00:01:00.000Z',
  answered: 1,
  correct: 1,
  bestStreak: 1,
  score: 10,
};

/**
 * Every module here carries state at module scope (`cachedDeviceId`,
 * `autoDrainStarted`, the drain timer). `vi.resetModules` plus a fresh
 * dynamic import is what actually isolates one test from the next; reusing
 * a static import would leak the device-id cache and the auto-drain flag
 * across tests.
 */
async function load() {
  vi.resetModules();
  const apiClientModule = await import('./apiClient');
  const outboxModule = await import('./outbox');
  const remoteModule = await import('./RemoteScoreStore');

  const apiRequest = vi.mocked(apiClientModule.apiRequest);
  const enqueue = vi.mocked(outboxModule.enqueue);
  const drain = vi.mocked(outboxModule.drain);
  const nextDrainAt = vi.mocked(outboxModule.nextDrainAt);

  drain.mockResolvedValue(undefined);
  nextDrainAt.mockReturnValue(null);

  return {
    apiRequest,
    enqueue,
    drain,
    nextDrainAt,
    RemoteScoreStore: remoteModule.RemoteScoreStore,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RemoteScoreStore.submitSession', () => {
  it('does nothing for a session with no per-answer data, and never touches the outbox', async () => {
    const { RemoteScoreStore, enqueue, drain } = await load();
    const store = new RemoteScoreStore();
    drain.mockClear();

    await store.submitSession(SESSION_WITHOUT_ANSWERS);

    expect(enqueue).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });

  it('enqueues a session with answers and kicks an immediate drain', async () => {
    const { RemoteScoreStore, enqueue, drain } = await load();
    const store = new RemoteScoreStore();
    drain.mockClear();

    await store.submitSession(SESSION_WITH_ANSWERS);

    expect(enqueue).toHaveBeenCalledWith(
      {
        sessionId: 'session-1',
        deckId: 'deck-1',
        startedAt: '2026-09-20T00:00:00.000Z',
        endedAt: '2026-09-20T00:01:00.000Z',
        answers: SESSION_WITH_ANSWERS.answers,
        claimedScore: 10,
        claimedBestStreak: 1,
        distinctCorrect: 0,
      },
      expect.any(Number),
    );
    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalled();
    });
  });
});

describe('RemoteScoreStore.topScores', () => {
  it('maps rows and marks the caller\u2019s own row via the cached device id', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockImplementation((_schema, options) => {
      if (options.path.startsWith('/api/leaderboard')) return Promise.resolve(ok(LEADERBOARD_RESPONSE));
      if (options.path === '/api/me') return Promise.resolve(ok(ME_RESPONSE));
      throw new Error(`unexpected path ${options.path}`);
    });
    const store: RemoteScoreStoreType = new RemoteScoreStore();

    const rows = await store.topScores('all-time', 10);

    expect(rows).toEqual([
      {
        rank: 1,
        displayName: 'Ada',
        avatarSeed: 'ada',
        score: 100,
        bestStreak: 9,
        achievedAt: '2026-09-20T00:00:00.000Z',
        isMe: true,
      },
      {
        rank: 2,
        displayName: 'Bo',
        avatarSeed: 'bo',
        score: 80,
        bestStreak: 5,
        achievedAt: '2026-09-19T00:00:00.000Z',
        isMe: false,
      },
    ]);
  });

  it('throws when the leaderboard call fails, so the composite store can fall back', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockImplementation((_schema, options) => {
      if (options.path.startsWith('/api/leaderboard')) return Promise.resolve(fail(500, 'boom'));
      return Promise.resolve(ok(ME_RESPONSE));
    });
    const store = new RemoteScoreStore();

    await expect(store.topScores('all-time', 10)).rejects.toThrow('boom');
  });

  it('marks no row as mine when the device has never registered', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockImplementation((_schema, options) => {
      if (options.path.startsWith('/api/leaderboard')) return Promise.resolve(ok(LEADERBOARD_RESPONSE));
      return Promise.resolve(fail(null, 'No device token.'));
    });
    const store = new RemoteScoreStore();

    const rows = await store.topScores('all-time', 10);

    expect(rows.every((row) => !row.isMe)).toBe(true);
  });
});

describe('RemoteScoreStore.myRank', () => {
  it('returns the rank from /api/me', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(ok(ME_RESPONSE));
    const store = new RemoteScoreStore();

    await expect(store.myRank()).resolves.toBe(3);
  });

  it('throws when /api/me fails', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(fail(401, 'nope'));
    const store = new RemoteScoreStore();

    await expect(store.myRank()).rejects.toThrow('nope');
  });
});

describe('RemoteScoreStore.profile', () => {
  it('maps /api/me into a Profile', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(ok(ME_RESPONSE));
    const store = new RemoteScoreStore();

    await expect(store.profile()).resolves.toEqual({
      displayName: 'Ada',
      avatarSeed: 'ada',
      createdAt: '2026-09-20T00:00:00.000Z',
      totalScore: 120,
      bestStreakEver: 9,
    });
  });

  it('throws when /api/me fails', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(fail(500, 'server error'));
    const store = new RemoteScoreStore();

    await expect(store.profile()).rejects.toThrow('server error');
  });

  it('syncs badges into useGameStore as a side effect, even though Profile has no badges field', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(ok({ ...ME_RESPONSE, badges: ['first-session'] }));
    const store = new RemoteScoreStore();
    const { useGameStore } = await import('../store/useGameStore');
    useGameStore.setState({ badges: [], celebrateBadges: [] });

    await store.profile();

    expect(useGameStore.getState().badges).toEqual(['first-session']);
  });
});

describe('RemoteScoreStore.badges', () => {
  it('returns the badges from /api/me and syncs them into useGameStore', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(ok({ ...ME_RESPONSE, badges: ['first-session', 'streak-10'] }));
    const store = new RemoteScoreStore();
    const { useGameStore } = await import('../store/useGameStore');
    useGameStore.setState({ badges: [], celebrateBadges: [] });

    await expect(store.badges()).resolves.toEqual(['first-session', 'streak-10']);
    expect(useGameStore.getState().badges).toEqual(['first-session', 'streak-10']);
  });

  it('throws when /api/me fails', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(fail(500, 'server error'));
    const store = new RemoteScoreStore();

    await expect(store.badges()).rejects.toThrow('server error');
  });
});

describe('RemoteScoreStore.setProfile', () => {
  it('PUTs a complete displayName+avatarSeed pair', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(ok(ME_RESPONSE));
    const store = new RemoteScoreStore();

    await store.setProfile({ displayName: 'Ada', avatarSeed: 'ada' });

    expect(apiRequest).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        method: 'PUT',
        path: '/api/me',
        body: { displayName: 'Ada', avatarSeed: 'ada' },
      }),
    );
  });

  it('does nothing when either field is missing, since the Worker cannot fill it in', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    const store = new RemoteScoreStore();

    await store.setProfile({ displayName: 'Ada' });

    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('throws when the PUT fails', async () => {
    const { RemoteScoreStore, apiRequest } = await load();
    apiRequest.mockResolvedValue(fail(400, 'Namnet \u00e4r f\u00f6r kort.'));
    const store = new RemoteScoreStore();

    await expect(store.setProfile({ displayName: 'A', avatarSeed: 'ada' })).rejects.toThrow(
      'Namnet \u00e4r f\u00f6r kort.',
    );
  });
});

describe('auto drain wiring', () => {
  it('only wires the drain timer and the online listener once across instances', async () => {
    const { RemoteScoreStore, drain } = await load();
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');

    // Constructing a second instance must not double the 'online' listener —
    // StrictMode and any stray extra construction rely on this.
    new RemoteScoreStore();
    new RemoteScoreStore();

    await vi.waitFor(() => {
      expect(drain).toHaveBeenCalledTimes(1);
    });
    expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
    expect(addEventListenerSpy).toHaveBeenCalledWith('online', expect.any(Function));

    addEventListenerSpy.mockRestore();
  });
});
