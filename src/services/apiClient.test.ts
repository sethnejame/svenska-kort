import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { apiRequest } from './apiClient';
import { setToken } from './deviceToken';
import { resetStorageForTests } from '../store/storage';

const schema = z.object({ ok: z.literal(true), value: z.number() });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  resetStorageForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiRequest', () => {
  it('refuses an authenticated call with no device token, without touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await apiRequest(schema, { method: 'GET', path: '/api/me' });

    expect(result).toEqual({ ok: false, status: null, message: 'No device token.' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sends the bearer token on an authenticated call', async () => {
    setToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: 1 }));
    vi.stubGlobal('fetch', fetchSpy);

    await apiRequest(schema, { method: 'GET', path: '/api/me' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer 3f2504e0-4f89-41d3-9a0c-0305e82c3301');
  });

  it('sends no Authorization header when auth is false, even with no token', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: 1 }));
    vi.stubGlobal('fetch', fetchSpy);

    const result = await apiRequest(schema, { method: 'GET', path: '/api/leaderboard', auth: false });

    expect(result).toEqual({ ok: true, data: { ok: true, value: 1 } });
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('parses a valid 2xx body against the schema', async () => {
    setToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: 7 })));

    const result = await apiRequest(schema, { method: 'GET', path: '/api/me' });

    expect(result).toEqual({ ok: true, data: { ok: true, value: 7 } });
  });

  it('reads the shared error shape off a non-2xx response', async () => {
    setToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, { error: 'Namnet är för kort.' })));

    const result = await apiRequest(schema, { method: 'PUT', path: '/api/me', body: {} });

    expect(result).toEqual({ ok: false, status: 400, message: 'Namnet är för kort.' });
  });

  it('falls back to a bare status when the error body does not parse', async () => {
    setToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 500 })),
    );

    const result = await apiRequest(schema, { method: 'GET', path: '/api/me' });

    expect(result).toEqual({ ok: false, status: 500, message: 'HTTP 500' });
  });

  it('treats a 2xx body that fails the schema as a server-shape mismatch', async () => {
    setToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, value: 'nope' })));

    const result = await apiRequest(schema, { method: 'GET', path: '/api/me' });

    expect(result).toEqual({ ok: false, status: 200, message: 'Unexpected response shape.' });
  });

  it('reports a thrown fetch as a null-status network error', async () => {
    setToken('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));

    const result = await apiRequest(schema, { method: 'GET', path: '/api/me' });

    expect(result).toEqual({ ok: false, status: null, message: 'Failed to fetch' });
  });
});
