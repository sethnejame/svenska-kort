import { beforeEach, describe, expect, it } from 'vitest';
import type { SubmitSessionRequest } from '../../shared/api';
import { replaySession, unpackAnswers, type PackedAnswer } from '../../shared/scoring';
import { flagsFor, submitSession, type SessionFlag } from './session';
import { requireDevice, type Device } from './auth';
import { TestD1 } from '../test/d1';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

let db: TestD1;
let device: Device;

beforeEach(async () => {
  db = new TestD1();
  device = await requireDevice(
    new Request('https://api.test/', { headers: { Authorization: `Bearer ${TOKEN}` } }),
    { db: db as unknown as D1Database, now: NOW, uuid: () => 'device-1' },
  );
  db.resetCounters();
});

function deps() {
  return { db: db as unknown as D1Database, now: NOW };
}

/** `count` answers each taking `elapsedMs`, with the wall clock agreeing. */
function session(
  count: number,
  elapsedMs: number,
  over: Partial<SubmitSessionRequest> = {},
): SubmitSessionRequest {
  const answers = Array.from({ length: count }, (_, i) => ({
    entryId: `entry-${i}`,
    verdict: 'correct' as const,
    elapsedMs,
    wasTyped: true,
    acceptedOnRetry: false,
  }));

  const startedAt = new Date(NOW - count * elapsedMs).toISOString();
  const body: SubmitSessionRequest = {
    sessionId: 'session-1',
    deckId: 'nyheter',
    startedAt,
    endedAt: new Date(NOW).toISOString(),
    answers,
    claimedScore: replaySession(answers).score,
    claimedBestStreak: replaySession(answers).bestStreak,
    ...over,
  };
  return body;
}

function storedFlags(): SessionFlag[] | null {
  const rows = db.read<{ flags: string | null }>('SELECT flags FROM session');
  const raw = rows[0]?.flags ?? null;
  return raw === null ? null : (JSON.parse(raw) as SessionFlag[]);
}

describe('flagsFor', () => {
  it('leaves an ordinary session clean', () => {
    const body = session(20, 5000);
    expect(flagsFor(body, replaySession(body.answers).score)).toEqual([]);
  });

  it('accepts a genuinely fast learner at 2.5 answers a second', () => {
    // 400 ms an answer, sustained for the whole session. This is the case the
    // checks exist to NOT catch: a false positive here costs a real learner
    // their leaderboard row.
    const body = session(30, 400);
    expect(flagsFor(body, replaySession(body.answers).score)).toEqual([]);
  });

  it('flags 4 answers a second', () => {
    const body = session(30, 250);
    expect(flagsFor(body, replaySession(body.answers).score)).toContain('fast-rate');
  });

  it('flags a burst hidden inside an otherwise ordinary session', () => {
    // Averaging would miss this: ten answers at 100 ms buried among thirty slow
    // ones still averages well under the ceiling.
    const body = session(40, 5000);
    for (let i = 10; i < 20; i += 1) {
      const answer = body.answers[i];
      if (answer) answer.elapsedMs = 100;
    }
    expect(flagsFor(body, replaySession(body.answers).score)).toContain('fast-rate');
  });

  it('does not flag a rate it cannot see, under ten answers', () => {
    // Too short to window. `short-session` is what covers this instead.
    const body = session(9, 400);
    expect(flagsFor(body, replaySession(body.answers).score)).not.toContain('fast-rate');
  });

  it('flags a wall clock too short for the answers it claims', () => {
    const body = session(8, 5000, {
      startedAt: new Date(NOW - 1000).toISOString(),
      endedAt: new Date(NOW).toISOString(),
    });
    expect(flagsFor(body, replaySession(body.answers).score)).toContain('short-session');
  });

  it('flags a claimed score that does not follow from the answers', () => {
    const body = session(10, 5000, { claimedScore: 999_999 });
    expect(flagsFor(body, replaySession(body.answers).score)).toContain('score-mismatch');
  });

  it('flags timings that add up to more than the session lasted', () => {
    const body = session(10, 5000, {
      startedAt: new Date(NOW - 10_000).toISOString(),
      endedAt: new Date(NOW).toISOString(),
    });
    expect(flagsFor(body, replaySession(body.answers).score)).toContain('timing-inconsistent');
  });

  it('allows timings to exceed the wall clock slightly, because clocks drift', () => {
    const body = session(10, 1000, {
      startedAt: new Date(NOW - 9500).toISOString(),
      endedAt: new Date(NOW).toISOString(),
    });
    expect(flagsFor(body, replaySession(body.answers).score)).not.toContain('timing-inconsistent');
  });

  it('flags an answer nobody could have read, and one taking negative time', () => {
    for (const elapsedMs of [249, 0, -5000]) {
      const body = session(20, 5000);
      const answer = body.answers[3];
      if (answer) answer.elapsedMs = elapsedMs;
      expect(flagsFor(body, replaySession(body.answers).score)).toContain('impossible-timing');
    }
  });

  it('treats 250 ms as possible and 249 as not', () => {
    const fast = session(20, 5000);
    const answer = fast.answers[0];
    if (answer) answer.elapsedMs = 250;
    expect(flagsFor(fast, replaySession(fast.answers).score)).not.toContain('impossible-timing');
  });

  it('leaves an empty session completely unflagged', () => {
    const body = session(0, 0, {
      startedAt: new Date(NOW).toISOString(),
      claimedScore: 0,
      claimedBestStreak: 0,
    });
    expect(flagsFor(body, 0)).toEqual([]);
  });
});

describe('submitSession — the score is the server’s', () => {
  it('stores the computed score and keeps the claim beside it', async () => {
    const body = session(10, 5000, { claimedScore: 999_999 });
    const response = await submitSession(body, device, deps());

    expect(response.score).toBe(replaySession(body.answers).score);
    expect(response.score).not.toBe(999_999);

    const rows = db.read<{ score: number; claimed_score: number }>(
      'SELECT score, claimed_score FROM session',
    );
    expect(rows[0]?.score).toBe(response.score);
    expect(rows[0]?.claimed_score).toBe(999_999);
  });

  it('keeps a liar off the leaderboard by flagging, not by refusing', async () => {
    const response = await submitSession(session(10, 5000, { claimedScore: 999_999 }), device, deps());

    expect(storedFlags()).toContain('score-mismatch');
    // The response is an ordinary success. Nothing in it mentions a flag.
    expect(JSON.stringify(response)).not.toContain('flag');
    expect(JSON.stringify(response)).not.toContain('mismatch');
  });

  it('never tells a flagged learner anything a clean one is not told', async () => {
    const flagged = await submitSession(session(30, 250), device, deps());
    expect(Object.keys(flagged).sort()).toEqual([
      'answered',
      'bestStreak',
      'correct',
      'rank',
      'score',
      'sessionId',
      'totalScore',
    ]);
  });

  it('stores nothing in flags for a clean session', async () => {
    await submitSession(session(20, 5000), device, deps());
    expect(storedFlags()).toBeNull();
  });

  it('handles a session with no answers', async () => {
    const response = await submitSession(
      session(0, 0, {
        startedAt: new Date(NOW).toISOString(),
        claimedScore: 0,
        claimedBestStreak: 0,
      }),
      device,
      deps(),
    );

    expect(response.score).toBe(0);
    expect(response.answered).toBe(0);
    expect(storedFlags()).toBeNull();
  });

  it('files the session into the season the server is in', async () => {
    await submitSession(session(10, 5000), device, deps());
    const rows = db.read<{ season_id: string }>('SELECT season_id FROM session');
    expect(rows[0]?.season_id).toBe('2026-W39');
  });

  it('stores the timings in the packed form, replayable to the same score', async () => {
    const body = session(10, 5000);
    const response = await submitSession(body, device, deps());

    const rows = db.read<{ timings: string }>('SELECT timings FROM session');
    const packed = JSON.parse(rows[0]?.timings ?? '[]') as PackedAnswer[];
    expect(replaySession(unpackAnswers(packed)).score).toBe(response.score);
  });
});

describe('submitSession — the device totals', () => {
  it('credits the device and reports the new total', async () => {
    const response = await submitSession(session(10, 5000), device, deps());

    const rows = db.read<{ total_score: number }>('SELECT total_score FROM device');
    expect(rows[0]?.total_score).toBe(response.score);
    expect(response.totalScore).toBe(response.score);
  });

  it('adds to a total that is already there', async () => {
    db.seed('UPDATE device SET total_score = 500, best_streak = 4');
    const withHistory = { ...device, total_score: 500, best_streak: 4 };

    const response = await submitSession(session(10, 5000), withHistory, deps());

    expect(response.totalScore).toBe(500 + response.score);
    const rows = db.read<{ total_score: number }>('SELECT total_score FROM device');
    expect(rows[0]?.total_score).toBe(500 + response.score);
  });

  it('raises the device best streak but never lowers it', async () => {
    db.seed('UPDATE device SET best_streak = 40');
    await submitSession(session(10, 5000), { ...device, best_streak: 40 }, deps());
    expect(db.read<{ best_streak: number }>('SELECT best_streak FROM device')[0]?.best_streak).toBe(
      40,
    );
  });

  it('credits a flagged session to the learner’s own total', async () => {
    // Held off the leaderboard, still theirs. Being flagged is not a punishment.
    const response = await submitSession(session(30, 250), device, deps());
    expect(response.totalScore).toBe(response.score);
    expect(storedFlags()).not.toBeNull();
  });
});

describe('submitSession — idempotency', () => {
  it('creates one row and answers the same thing twice', async () => {
    const body = session(10, 5000);
    const first = await submitSession(body, device, deps());
    const second = await submitSession(body, device, deps());

    expect(second).toEqual(first);
    expect(db.read('SELECT id FROM session')).toHaveLength(1);
  });

  it('does not credit the device twice', async () => {
    const body = session(10, 5000);
    const first = await submitSession(body, device, deps());
    // The device object the second call gets is the one auth read back, which by
    // then already includes the first credit.
    await submitSession(body, { ...device, total_score: first.score }, deps());

    const rows = db.read<{ total_score: number }>('SELECT total_score FROM device');
    expect(rows[0]?.total_score).toBe(first.score);
  });

  it('writes nothing at all on the replay', async () => {
    const body = session(10, 5000);
    await submitSession(body, device, deps());
    db.resetCounters();

    await submitSession(body, device, deps());
    expect(db.rowsWritten).toBe(0);
  });

  it('ignores a resubmission that tries to change the score', async () => {
    const body = session(10, 5000);
    const first = await submitSession(body, device, deps());

    const tampered = { ...body, answers: session(60, 5000).answers, claimedScore: 5000 };
    const second = await submitSession(tampered, device, deps());

    expect(second.score).toBe(first.score);
    expect(db.read('SELECT id FROM session')).toHaveLength(1);
  });

  it('will not read back another device’s session through a guessed id', async () => {
    await submitSession(session(10, 5000), device, deps());

    const other = await requireDevice(
      new Request('https://api.test/', {
        headers: { Authorization: 'Bearer 9c858901-8a57-4791-81fe-4c455b099bc9' },
      }),
      { db: db as unknown as D1Database, now: NOW, uuid: () => 'device-2' },
    );

    // Same session id, different device: the insert conflicts, and the read-back
    // must not hand over the first learner's numbers.
    const response = await submitSession(session(10, 5000), other, deps());
    expect(response.score).toBe(0);
    expect(response.answered).toBe(0);
  });
});

describe('submitSession — the write budget', () => {
  it('writes exactly two rows per session', async () => {
    await submitSession(session(71, 5000), device, deps());
    // One session row, one device row. A per-answer table would have written 72
    // here and put the daily ceiling at 1,408 sessions instead of 50,000.
    expect(db.rowsWritten).toBe(2);
  });

  it('writes two rows for a 500-answer session too — the cost does not scale', async () => {
    await submitSession(session(500, 5000), device, deps());
    expect(db.rowsWritten).toBe(2);
  });

  it('costs one round trip, so the two writes are one transaction', async () => {
    await submitSession(session(20, 5000), device, deps());
    expect(db.queries).toHaveLength(2);
  });

  it('looks a replayed session up by the primary key', () => {
    const plan = db.explain(
      `SELECT s.answered FROM session s JOIN device d ON d.id = s.device_id
        WHERE s.id = ? AND s.device_id = ? LIMIT 1`,
      'x',
      'y',
    );
    expect(plan.join(' ')).toContain('USING INDEX');
    expect(plan.join(' ')).not.toContain('SCAN session');
  });
});

describe('submitSession — agreement with the client', () => {
  /** A deterministic generator, so a failure names a seed rather than a mood. */
  function fixture(seed: number): SubmitSessionRequest {
    let state = seed * 2654435761;
    const next = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };

    const count = 5 + Math.floor(next() * 66);
    const answers = Array.from({ length: count }, (_, i) => {
      const roll = next();
      return {
        entryId: `entry-${i}`,
        verdict: roll < 0.7 ? ('correct' as const) : roll < 0.85 ? ('close' as const) : ('wrong' as const),
        elapsedMs: 1000 + Math.floor(next() * 9000),
        wasTyped: next() > 0.1,
        acceptedOnRetry: next() > 0.85,
      };
    });

    const totals = replaySession(answers);
    const spent = answers.reduce((sum, a) => sum + a.elapsedMs, 0);
    return {
      sessionId: `fixture-${seed}`,
      deckId: 'alla',
      startedAt: new Date(NOW - spent - 1000).toISOString(),
      endedAt: new Date(NOW).toISOString(),
      answers,
      // An honest client sends what `shared/scoring.ts` told it, because it is
      // the same file. Any drift shows up as a `score-mismatch` flag.
      claimedScore: totals.score,
      claimedBestStreak: totals.bestStreak,
    };
  }

  it('recomputes 100 honest sessions to exactly the claimed score', async () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const body = fixture(seed);
      const response = await submitSession(body, device, deps());
      expect(response.score, `seed ${seed}`).toBe(body.claimedScore);
      expect(response.bestStreak, `seed ${seed}`).toBe(body.claimedBestStreak);
    }
  });

  it('flags none of those 100 as a score mismatch', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const body = fixture(seed);
      expect(flagsFor(body, replaySession(body.answers).score), `seed ${seed}`).not.toContain(
        'score-mismatch',
      );
    }
  });
});

describe('submitSession — CPU', () => {
  it('prices and stores a 500-answer session well inside the 10 ms budget', async () => {
    const body = session(500, 5000);

    const start = performance.now();
    await submitSession(body, device, deps());
    const elapsed = performance.now() - start;

    // Generous, because this includes real SQLite work that D1 does off-CPU and
    // a cold JIT. The point is the order of magnitude: if this is ever tens of
    // milliseconds, something has become per-answer that should not be.
    expect(elapsed).toBeLessThan(50);
  });

  it('prices 500 answers in well under a millisecond', () => {
    const { answers } = session(500, 5000);
    const start = performance.now();
    for (let i = 0; i < 10; i += 1) replaySession(answers);
    expect((performance.now() - start) / 10).toBeLessThan(5);
  });
});
