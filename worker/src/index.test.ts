import { beforeEach, describe, expect, it } from 'vitest';
import worker, { type Env } from './index';
import { healthResponseSchema, meResponseSchema } from '../../shared/api';
import { TestD1 } from '../test/d1';

const ALLOWED = 'https://svenskakort.se';
const TOKEN = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

let db: TestD1;
let env: Env;

beforeEach(() => {
  db = new TestD1();
  env = { VERSION: 'abc1234', DB: db as unknown as D1Database };
});

function call(path: string, init: RequestInit = {}, origin: string | null = ALLOWED) {
  const headers = new Headers(init.headers);
  if (origin !== null) headers.set('Origin', origin);
  return worker.fetch(new Request(`https://api.test${path}`, { ...init, headers }), env);
}

function authed(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
  const headers = new Headers(init.headers);
  if (token !== null) headers.set('Authorization', `Bearer ${token}`);
  return call(path, { ...init, headers });
}

describe('GET /api/health', () => {
  it('answers the shape the shared schema describes', async () => {
    const response = await call('/api/health');
    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(await response.json())).toEqual({
      ok: true,
      version: 'abc1234',
    });
  });

  it('carries the CORS headers for an allowed origin', async () => {
    const response = await call('/api/health');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ALLOWED);
  });

  it('answers a disallowed origin without the header the browser needs', async () => {
    const response = await call('/api/health', {}, 'https://evil.example');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('routing', () => {
  it('preflights', async () => {
    const response = await call('/api/health', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
  });

  it('404s an unknown path', async () => {
    const response = await call('/api/nope');
    expect(response.status).toBe(404);
  });

  it('405s a known path under the wrong method', async () => {
    const response = await call('/api/health', { method: 'POST' });
    expect(response.status).toBe(405);
  });

  it('says the same generic thing on every failure', async () => {
    const response = await call('/api/nope');
    expect(await response.json()).toEqual({ error: 'Not found' });
  });

  it('turns a thrown handler into a 500 that reveals nothing', async () => {
    const boom = new Request('https://api.test/api/health', {
      headers: { Origin: ALLOWED },
    });
    // A handler that throws is the only way to reach the catch; force it by
    // taking VERSION away, which the health handler reads.
    const broken = {
      get VERSION(): string {
        throw new Error('D1_ERROR: secret table name');
      },
    } as Env;

    const response = await worker.fetch(boom, broken);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('secret table name');
  });
});

describe('/api/me', () => {
  it('registers on first sight and answers the shared schema', async () => {
    const response = await authed('/api/me');
    expect(response.status).toBe(200);

    const body = meResponseSchema.parse(await response.json());
    expect(body.displayName).toBe('Du');
    expect(body.isAdmin).toBe(false);
    expect(body.rank).toBeNull();
    expect(db.read('SELECT id FROM device')).toHaveLength(1);
  });

  it('401s without a token', async () => {
    const response = await authed('/api/me', {}, null);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('403s a banned device on an authenticated route', async () => {
    await authed('/api/me');
    db.seed('UPDATE device SET is_banned = 1');

    const response = await authed('/api/me');
    expect(response.status).toBe(403);
  });

  it('names the device from the body on POST', async () => {
    const response = await authed('/api/me', {
      method: 'POST',
      body: JSON.stringify({ displayName: 'Anna', avatarSeed: 'anna' }),
    });

    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Anna');
  });

  it('still registers when POST carries no usable body', async () => {
    const response = await authed('/api/me', { method: 'POST', body: 'not json' });
    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Du');
  });

  it('still registers when POST carries readable JSON that is not a registration', async () => {
    // A rejected hint is not a rejected registration: the learner gets an account
    // under the default name and can rename it later through PUT, where a bad
    // name is their own input and does deserve a 400.
    const response = await authed('/api/me', {
      method: 'POST',
      body: JSON.stringify({ displayName: '!!', avatarSeed: '' }),
    });

    expect(response.status).toBe(200);
    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Du');
  });

  it('rejects an over-long display name on PUT with a message the learner can act on', async () => {
    const response = await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'x'.repeat(21), avatarSeed: 'a' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json<{ error: string }>();
    expect(body.error).toMatch(/högst 20 tecken/);
  });

  it('rejects a display name carrying a bidi override', async () => {
    const response = await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: 'Anna\u202ehcnA', avatarSeed: 'a' }),
    });
    expect(response.status).toBe(400);
  });

  it('persists a profile update', async () => {
    await authed('/api/me');
    const response = await authed('/api/me', {
      method: 'PUT',
      body: JSON.stringify({ displayName: '  Björn  Nilsson ', avatarSeed: 'bjorn' }),
    });

    expect(meResponseSchema.parse(await response.json()).displayName).toBe('Björn Nilsson');
    const rows = db.read<{ display_name: string }>('SELECT display_name FROM device');
    expect(rows[0]?.display_name).toBe('Björn Nilsson');
  });

  it('400s a PUT with no body rather than 500ing', async () => {
    const response = await authed('/api/me', { method: 'PUT' });
    expect(response.status).toBe(400);
  });

  it('never puts the token in a response body', async () => {
    const response = await authed('/api/me');
    expect(await response.text()).not.toContain(TOKEN);
  });
});
