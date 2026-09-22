import { describe, expect, it } from 'vitest';
import worker, { type Env } from './index';
import { healthResponseSchema } from '../../shared/api';

const env: Env = { VERSION: 'abc1234' };
const ALLOWED = 'https://svenskakort.se';

function call(path: string, init: RequestInit = {}, origin: string | null = ALLOWED) {
  const headers = new Headers(init.headers);
  if (origin !== null) headers.set('Origin', origin);
  return worker.fetch(new Request(`https://api.test${path}`, { ...init, headers }), env);
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
