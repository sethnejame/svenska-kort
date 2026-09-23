import { beforeEach, describe, expect, it } from 'vitest';
import type { SubmitSessionRequest, SubmitSessionResponse } from '../../shared/api';
import type { ApiResult } from './apiClient';
import { backoffFor, drain, enqueue, nextDrainAt, OUTBOX_MAX, size, type Sender } from './outbox';
import { resetStorageForTests } from '../store/storage';

function payload(sessionId: string): SubmitSessionRequest {
  return {
    sessionId,
    deckId: 'deck-1',
    startedAt: '2026-09-20T00:00:00.000Z',
    endedAt: '2026-09-20T00:01:00.000Z',
    answers: [],
    claimedScore: 10,
    claimedBestStreak: 2,
  };
}

const RESPONSE: SubmitSessionResponse = {
  sessionId: 'ignored',
  score: 10,
  answered: 1,
  correct: 1,
  bestStreak: 2,
  totalScore: 10,
  rank: null,
};

function ok(): ApiResult<SubmitSessionResponse> {
  return { ok: true, data: RESPONSE };
}

function fail(status: number | null, message = 'nope'): ApiResult<SubmitSessionResponse> {
  return { ok: false, status, message };
}

beforeEach(() => {
  resetStorageForTests();
  localStorage.clear();
});

describe('backoffFor', () => {
  it('follows the documented schedule then holds steady', () => {
    expect(backoffFor(0)).toBe(1_000);
    expect(backoffFor(1)).toBe(4_000);
    expect(backoffFor(2)).toBe(15_000);
    expect(backoffFor(3)).toBe(60_000);
    expect(backoffFor(4)).toBe(5 * 60_000);
    expect(backoffFor(100)).toBe(5 * 60_000);
  });
});

describe('enqueue / size / nextDrainAt', () => {
  it('starts empty', () => {
    expect(size()).toBe(0);
    expect(nextDrainAt()).toBeNull();
  });

  it('queues an entry due immediately', () => {
    enqueue(payload('a'), 1_000);
    expect(size()).toBe(1);
    expect(nextDrainAt()).toBe(1_000);
  });

  it('reports the earliest due time across entries', () => {
    enqueue(payload('a'), 5_000);
    enqueue(payload('b'), 2_000);
    expect(nextDrainAt()).toBe(2_000);
  });

  it('drops the oldest entries past the cap', () => {
    for (let i = 0; i < OUTBOX_MAX + 10; i += 1) {
      enqueue(payload(`s${String(i)}`), i);
    }
    expect(size()).toBe(OUTBOX_MAX);
    // The oldest 10 (s0..s9) were dropped; the newest survive.
    expect(nextDrainAt()).toBe(10);
  });
});

describe('drain', () => {
  it('does nothing against an empty queue', async () => {
    const send: Sender = () => Promise.resolve(ok());
    await drain(send, 0);
    expect(size()).toBe(0);
  });

  it('leaves an entry that is not yet due, and does not call send for it', async () => {
    enqueue(payload('a'), 10_000);
    let calls = 0;
    const send: Sender = () => {
      calls += 1;
      return Promise.resolve(ok());
    };

    await drain(send, 0);

    expect(calls).toBe(0);
    expect(size()).toBe(1);
  });

  it('drops an entry on a 2xx result', async () => {
    enqueue(payload('a'), 0);
    const send: Sender = () => Promise.resolve(ok());

    await drain(send, 0);

    expect(size()).toBe(0);
  });

  it('drops an entry on a sub-500 failure, the payload is permanently malformed', async () => {
    enqueue(payload('a'), 0);
    const send: Sender = () => Promise.resolve(fail(400));

    await drain(send, 0);

    expect(size()).toBe(0);
  });

  it('keeps and backs off an entry on a 5xx failure', async () => {
    enqueue(payload('a'), 0);
    const send: Sender = () => Promise.resolve(fail(503));

    await drain(send, 1_000);

    expect(size()).toBe(1);
    expect(nextDrainAt()).toBe(1_000 + backoffFor(1));
  });

  it('keeps and backs off an entry on a network error (null status)', async () => {
    enqueue(payload('a'), 0);
    const send: Sender = () => Promise.resolve(fail(null));

    await drain(send, 1_000);

    expect(size()).toBe(1);
    expect(nextDrainAt()).toBe(1_000 + backoffFor(1));
  });

  it('advances the backoff schedule across repeated failures', async () => {
    enqueue(payload('a'), 0);
    const send: Sender = () => Promise.resolve(fail(503));

    await drain(send, 0);
    await drain(send, backoffFor(1));
    await drain(send, backoffFor(1) + backoffFor(2));

    expect(size()).toBe(1);
  });

  it('sends every due entry sequentially and settles mixed outcomes independently', async () => {
    enqueue(payload('keep'), 0);
    enqueue(payload('drop-ok'), 0);
    enqueue(payload('drop-bad'), 0);
    const seen: string[] = [];
    const send: Sender = (p) => {
      seen.push(p.sessionId);
      if (p.sessionId === 'keep') return Promise.resolve(fail(503));
      if (p.sessionId === 'drop-bad') return Promise.resolve(fail(400));
      return Promise.resolve(ok());
    };

    await drain(send, 0);

    expect(seen).toEqual(['keep', 'drop-ok', 'drop-bad']);
    expect(size()).toBe(1);
  });
});
