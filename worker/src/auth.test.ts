import { beforeEach, describe, expect, it } from 'vitest';
import { AuthError, bearerToken, requireDevice, sha256Hex, type AuthDeps } from './auth';
import { TestD1 } from '../test/d1';

const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const OTHER = '9c858901-8a57-4791-81fe-4c455b099bc9';

let db: TestD1;
let ids: number;

function deps(now = Date.parse('2026-09-22T12:00:00.000Z')): AuthDeps {
  return {
    db: db as unknown as D1Database,
    now,
    uuid: () => `device-${++ids}`,
  };
}

function call(token: string | null, extra: Record<string, string> = {}): Request {
  const headers = new Headers(extra);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return new Request('https://api.test/api/me', { headers });
}

beforeEach(() => {
  db = new TestD1();
  ids = 0;
});

describe('sha256Hex', () => {
  it('matches the known digest of the empty string', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('pads every byte to two hex characters', async () => {
    // 'c' digests to a value containing a byte below 0x10; a `toString(16)`
    // without padding produces 63 characters here instead of 64.
    for (const input of ['c', 'a', TOKEN, 'åäö']) {
      expect(await sha256Hex(input)).toHaveLength(64);
    }
  });

  it('never returns the token it was given', async () => {
    expect(await sha256Hex(TOKEN)).not.toContain(TOKEN);
  });
});

describe('bearerToken', () => {
  it('reads a well-formed uuid', () => {
    expect(bearerToken(call(TOKEN))).toBe(TOKEN);
  });

  it('is null with no header at all', () => {
    expect(bearerToken(call(null))).toBeNull();
  });

  it('is null for a scheme that is not Bearer', () => {
    const request = new Request('https://api.test/', {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(bearerToken(request)).toBeNull();
  });

  it('refuses anything that is not a uuid, so no junk reaches a query', () => {
    for (const bad of ['', 'abc', "' OR 1=1 --", 'x'.repeat(500), '3f2504e0-4f89-41d3-9a0c']) {
      const request = new Request('https://api.test/', {
        headers: { Authorization: `Bearer ${bad}` },
      });
      expect(bearerToken(request)).toBeNull();
    }
  });
});

describe('requireDevice — registration on first sight', () => {
  it('creates exactly one row for a token nobody has seen', async () => {
    const device = await requireDevice(call(TOKEN), deps(), {
      displayName: 'Anna',
      avatarSeed: 'anna',
    });

    expect(device.display_name).toBe('Anna');
    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });

  it('stores only the hash, never the token', async () => {
    await requireDevice(call(TOKEN), deps());
    const rows = db.read<{ token_hash: string }>('SELECT token_hash FROM device');
    expect(rows[0]?.token_hash).toBe(await sha256Hex(TOKEN));
    expect(JSON.stringify(rows)).not.toContain(TOKEN);
  });

  it('registers without a profile, so a first session cannot fail over a name', async () => {
    const device = await requireDevice(call(TOKEN), deps());
    expect(device.display_name).toBe('Du');
    expect(device.avatar_seed).toBe('du');
  });

  it('normalizes the display name the same way the client does', async () => {
    const device = await requireDevice(call(TOKEN), deps(), {
      displayName: '  Anna    Lindgren  ',
      avatarSeed: 'anna',
    });
    expect(device.display_name).toBe('Anna Lindgren');
  });

  it('creates nothing on a second call and returns the same device', async () => {
    const first = await requireDevice(call(TOKEN), deps());
    const second = await requireDevice(call(TOKEN), deps());

    expect(second.id).toBe(first.id);
    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });

  it('keeps two different tokens on two different devices', async () => {
    const a = await requireDevice(call(TOKEN), deps());
    const b = await requireDevice(call(OTHER), deps());

    expect(a.id).not.toBe(b.id);
    expect(db.read('SELECT id FROM device')).toHaveLength(2);
  });

  it('does not double-insert when two calls arrive together', async () => {
    const [a, b] = await Promise.all([
      requireDevice(call(TOKEN), deps()),
      requireDevice(call(TOKEN), deps()),
    ]);

    expect(db.read('SELECT id FROM device')).toHaveLength(1);
    expect(a.id).toBe(b.id);
  });
});

/**
 * The genuine race, forced rather than hoped for.
 *
 * Two requests can both pass the initial lookup before either inserts, and then
 * the loser's INSERT meets the unique index on `token_hash`. Awaiting two calls
 * together does not reproduce it — the double's SQLite is synchronous, so one
 * finishes inserting before the other looks — and a test that cannot fail is
 * worse than no test. So the lookup is made to lie exactly once, which is the
 * observable behaviour of losing the race.
 */
function blindFirstLookup(real: TestD1, times = 1): D1Database {
  let remaining = times;
  return {
    prepare(sql: string) {
      const isDeviceLookup = sql.includes('FROM device WHERE token_hash');
      if (isDeviceLookup && remaining > 0) {
        remaining -= 1;
        return { bind: () => ({ first: () => Promise.resolve(null) }) };
      }
      return real.prepare(sql);
    },
  } as unknown as D1Database;
}

describe('requireDevice — losing the registration race', () => {
  it('returns the winner’s row instead of failing on the unique index', async () => {
    const winner = await requireDevice(call(TOKEN), deps());

    const loser = await requireDevice(call(TOKEN), {
      ...deps(),
      db: blindFirstLookup(db),
    });

    expect(loser.id).toBe(winner.id);
    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });

  it('refuses a banned device even when discovered through the race', async () => {
    await requireDevice(call(TOKEN), deps());
    db.seed('UPDATE device SET is_banned = 1');

    await expect(
      requireDevice(call(TOKEN), { ...deps(), db: blindFirstLookup(db) }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('401s rather than inventing a device if the row is gone by the read-back', async () => {
    await requireDevice(call(TOKEN), deps());

    // Both lookups blind. The row is really there, so the INSERT still conflicts
    // and returns nothing — but the read-back that should find the winner comes
    // back empty, which in production means a concurrent delete. Nothing in this
    // API deletes a device, so this is unreachable; it is covered because an
    // unreachable 401 is still better than a 500.
    await expect(
      requireDevice(call(TOKEN), { ...deps(), db: blindFirstLookup(db, 2) }),
    ).rejects.toMatchObject({ status: 401 });

    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });
});

describe('requireDevice — refusals', () => {
  it('401s a missing token', async () => {
    await expect(requireDevice(call(null), deps())).rejects.toMatchObject({ status: 401 });
  });

  it('401s a malformed token', async () => {
    const request = new Request('https://api.test/', {
      headers: { Authorization: 'Bearer nope' },
    });
    await expect(requireDevice(request, deps())).rejects.toMatchObject({ status: 401 });
  });

  it('never 500s on a bad token — it is an ordinary client mistake', async () => {
    await expect(requireDevice(call(null), deps())).rejects.toBeInstanceOf(AuthError);
  });

  it('403s a banned device', async () => {
    await requireDevice(call(TOKEN), deps());
    db.seed('UPDATE device SET is_banned = 1');

    await expect(requireDevice(call(TOKEN), deps())).rejects.toMatchObject({ status: 403 });
  });

  it('says nothing about the token in the error body', async () => {
    const error = await requireDevice(call(null), deps()).catch((e: unknown) => e);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });
});

describe('requireDevice — last_seen_at write budget', () => {
  const START = Date.parse('2026-09-22T12:00:00.000Z');

  it('writes once across fifty rapid calls', async () => {
    await requireDevice(call(TOKEN), deps(START));
    db.resetCounters();

    for (let i = 0; i < 50; i += 1) {
      await requireDevice(call(TOKEN), deps(START + i * 1000));
    }

    expect(db.rowsWritten).toBe(0);
  });

  it('writes again once an hour has passed', async () => {
    await requireDevice(call(TOKEN), deps(START));
    db.resetCounters();

    await requireDevice(call(TOKEN), deps(START + 60 * 60 * 1000));

    expect(db.rowsWritten).toBe(1);
    const rows = db.read<{ last_seen_at: string }>('SELECT last_seen_at FROM device');
    expect(rows[0]?.last_seen_at).toBe(new Date(START + 60 * 60 * 1000).toISOString());
  });

  it('treats an unparseable timestamp as stale rather than never touching it', async () => {
    await requireDevice(call(TOKEN), deps(START));
    db.seed("UPDATE device SET last_seen_at = 'not a date'");
    db.resetCounters();

    const device = await requireDevice(call(TOKEN), deps(START));
    expect(db.rowsWritten).toBe(1);
    expect(device.last_seen_at).toBe(new Date(START).toISOString());
  });

  it('costs one indexed read on the common path', async () => {
    await requireDevice(call(TOKEN), deps(START));
    db.resetCounters();

    await requireDevice(call(TOKEN), deps(START + 1000));

    expect(db.rowsRead).toBe(1);
    expect(db.queries).toHaveLength(1);
  });

  it('looks the device up by an index, not a scan', () => {
    const plan = db.explain('SELECT id FROM device WHERE token_hash = ? LIMIT 1', 'x');
    expect(plan.join(' ')).toContain('USING INDEX');
    expect(plan.join(' ')).not.toContain('SCAN device');
  });
});
