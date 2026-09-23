import { beforeEach, describe, expect, it } from 'vitest';
import { UNAMBIGUOUS_ALPHABET, TRANSFER_CODE_TTL_MS } from '../../shared/constants';
import { requireDevice, sha256Hex, type Device } from './auth';
import {
  CLAIM_GENERIC_ERROR,
  RATE_LIMIT_ERROR,
  claimCode,
  createCode,
  type TransferDeps,
} from './transfer';
import { TestD1 } from '../test/d1';

const NOW = Date.parse('2026-09-22T12:00:00.000Z');
const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const IP_HASH = 'ip-hash-a';

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

let uuidCounter = 0;
function deps(over: Partial<TransferDeps> = {}): TransferDeps {
  return {
    db: db as unknown as D1Database,
    now: NOW,
    uuid: () => `new-token-${String((uuidCounter += 1))}`,
    ...over,
  };
}

describe('createCode', () => {
  it('returns a code formatted as two groups of four', async () => {
    const created = await createCode(device, deps());
    expect(created.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('draws every character from the unambiguous alphabet only', async () => {
    for (let i = 0; i < 20; i += 1) {
      const created = await createCode(device, deps());
      const chars = created.code.replace('-', '').split('');
      for (const char of chars) expect(UNAMBIGUOUS_ALPHABET).toContain(char);
    }
  });

  it('excludes every ambiguous glyph from the alphabet itself', () => {
    for (const glyph of ['0', 'O', '1', 'I', 'L']) {
      expect(UNAMBIGUOUS_ALPHABET).not.toContain(glyph);
    }
  });

  it('stores only the hash, never the plaintext code', async () => {
    const created = await createCode(device, deps());
    const rows = db.read<{ code_hash: string }>('SELECT code_hash FROM transfer_code');
    const plain = created.code.replace('-', '');
    expect(rows.map((r) => r.code_hash)).not.toContain(plain);
    expect(rows).toHaveLength(1);
  });

  it('expires TRANSFER_CODE_TTL_MS after creation', async () => {
    const created = await createCode(device, deps());
    expect(Date.parse(created.expiresAt)).toBe(NOW + TRANSFER_CODE_TTL_MS);
  });

  it('invalidates the previous code for this device', async () => {
    await createCode(device, deps());
    await createCode(device, deps({ now: NOW + 1000 }));

    const active = db.read('SELECT code_hash FROM transfer_code WHERE used_at IS NULL');
    expect(active).toHaveLength(1);
  });
});

describe('claimCode', () => {
  it('issues a new token bound to the same device and marks the code used', async () => {
    const created = await createCode(device, deps());

    const outcome = await claimCode(created.code, IP_HASH, deps());

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected success');

    const rows = db.read<{ token_hash: string }>('SELECT token_hash FROM device WHERE id = ?', device.id);
    expect(rows[0]?.token_hash).toBe(await sha256Hex(outcome.token));

    const used = db.read<{ used_at: string | null }>('SELECT used_at FROM transfer_code');
    expect(used[0]?.used_at).not.toBeNull();
  });

  it('accepts a code typed without the dash or in lowercase', async () => {
    const created = await createCode(device, deps());
    const raw = created.code.replace('-', '').toLowerCase();

    const outcome = await claimCode(raw, IP_HASH, deps());
    expect(outcome.ok).toBe(true);
  });

  it('works exactly once', async () => {
    const created = await createCode(device, deps());

    await claimCode(created.code, IP_HASH, deps());
    const second = await claimCode(created.code, IP_HASH, deps());

    expect(second).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
  });

  it('refuses an expired code', async () => {
    const created = await createCode(device, deps());
    const afterExpiry = deps({ now: NOW + TRANSFER_CODE_TTL_MS + 1 });

    const outcome = await claimCode(created.code, IP_HASH, afterExpiry);
    expect(outcome).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
  });

  it('refuses a code that never existed', async () => {
    const outcome = await claimCode('ZZZZ-ZZZZ', IP_HASH, deps());
    expect(outcome).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
  });

  it('answers invalid, expired and used codes identically', async () => {
    const created = await createCode(device, deps());
    await claimCode(created.code, IP_HASH, deps({ now: NOW + 10 })); // now "used"

    const expiredCode = await createCode(device, deps({ now: NOW + 20 }));

    const usedOutcome = await claimCode(created.code, 'ip-b', deps({ now: NOW + 30 }));
    const neverExistedOutcome = await claimCode('QQQQ-QQQQ', 'ip-c', deps({ now: NOW + 30 }));
    const expiredOutcome = await claimCode(
      expiredCode.code,
      'ip-d',
      deps({ now: NOW + TRANSFER_CODE_TTL_MS + 100 }),
    );

    expect(usedOutcome).toEqual(neverExistedOutcome);
    expect(usedOutcome).toEqual(expiredOutcome);
  });

  it('refuses when a concurrent claim wins the race between lookup and update', async () => {
    const created = await createCode(device, deps());

    // A racy `db.batch` that lets a "concurrent" claim mark the code used
    // between this call's own SELECT and its batch — so the batch's guarded
    // UPDATE matches zero rows even though the SELECT it followed found one.
    const racyDb = {
      prepare: (sql: string) => db.prepare(sql),
      batch: async <T>(statements: Parameters<TestD1['batch']>[0]) => {
        db.seed(
          'UPDATE transfer_code SET used_at = ? WHERE used_at IS NULL',
          new Date(NOW + 5).toISOString(),
        );
        return db.batch<T>(statements);
      },
    } as unknown as D1Database;

    const outcome = await claimCode(created.code, IP_HASH, { db: racyDb, now: NOW, uuid: () => 'racer' });

    expect(outcome).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
  });

  it('never puts the submitted code in its error message', async () => {
    const secret = 'SECR-ETXY';
    const outcome = await claimCode(secret, IP_HASH, deps());
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.error).not.toContain('SECR');
  });

  describe('rate limiting', () => {
    it('allows 5 attempts a minute per IP and refuses the 6th', async () => {
      const outcomes = [];
      for (let i = 0; i < 6; i += 1) {
        outcomes.push(await claimCode('WRNG-CODE', IP_HASH, deps()));
      }

      const first5 = outcomes.slice(0, 5);
      const sixth = outcomes[5];

      for (const outcome of first5) expect(outcome).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
      expect(sixth).toEqual({ ok: false, status: 429, error: RATE_LIMIT_ERROR });
    });

    it('does not charge a rate-limited attempt against a real code lookup', async () => {
      const created = await createCode(device, deps());
      for (let i = 0; i < 5; i += 1) await claimCode('WRNG-CODE', IP_HASH, deps());

      db.resetCounters();
      const outcome = await claimCode(created.code, IP_HASH, deps());

      expect(outcome).toEqual({ ok: false, status: 429, error: RATE_LIMIT_ERROR });
      // No read of transfer_code at all: the limiter refused before the lookup.
      const readTransferCode = db.queries.some((q) => /transfer_code/i.test(q.sql));
      expect(readTransferCode).toBe(false);
    });

    it('tracks separate IPs independently', async () => {
      for (let i = 0; i < 5; i += 1) await claimCode('WRNG-CODE', 'ip-a', deps());

      const outcome = await claimCode('WRNG-CODE', 'ip-b', deps());
      expect(outcome).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
    });

    it('resets the counter on a new minute', async () => {
      for (let i = 0; i < 5; i += 1) await claimCode('WRNG-CODE', IP_HASH, deps());

      const outcome = await claimCode('WRNG-CODE', IP_HASH, deps({ now: NOW + 60_000 }));
      expect(outcome).toEqual({ ok: false, status: 400, error: CLAIM_GENERIC_ERROR });
    });
  });
});
