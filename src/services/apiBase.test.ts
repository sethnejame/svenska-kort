import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(value: unknown) {
  vi.resetModules();
  vi.stubEnv('VITE_API_BASE', value as string);
  return import('./apiBase');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('apiBase', () => {
  it('is empty when unset, which is the fully-local v1 state', async () => {
    const { API_BASE, hasApi } = await load(undefined);
    expect(API_BASE).toBe('');
    expect(hasApi()).toBe(false);
  });

  it('strips trailing slashes so a joined path never doubles up', async () => {
    const { apiUrl } = await load('https://api.svenskakort.se//');
    expect(apiUrl('/api/health')).toBe('https://api.svenskakort.se/api/health');
  });

  it('joins a path onto a configured base', async () => {
    const { apiUrl, hasApi } = await load('https://api.svenskakort.se');
    expect(hasApi()).toBe(true);
    expect(apiUrl('/api/health')).toBe('https://api.svenskakort.se/api/health');
  });
});
