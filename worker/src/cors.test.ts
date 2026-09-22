import { describe, expect, it } from 'vitest';
import { allowedOrigin, corsHeaders, preflight } from './cors';

const ALLOWED = 'https://svenskakort.se';
const EVIL = 'https://evil.example';

function from(origin: string | null, method = 'GET'): Request {
  return new Request('https://api.test/api/health', {
    method,
    ...(origin === null ? {} : { headers: { Origin: origin } }),
  });
}

describe('allowedOrigin', () => {
  it('admits the production origin', () => {
    expect(allowedOrigin(from(ALLOWED))).toBe(ALLOWED);
  });

  it('admits the local dev and preview origins', () => {
    expect(allowedOrigin(from('http://localhost:5173'))).toBe('http://localhost:5173');
    expect(allowedOrigin(from('http://localhost:4173'))).toBe('http://localhost:4173');
  });

  it('refuses an unlisted origin', () => {
    expect(allowedOrigin(from(EVIL))).toBeNull();
  });

  it('refuses an origin that merely starts with an allowed one', () => {
    expect(allowedOrigin(from('https://svenskakort.se.evil.example'))).toBeNull();
  });

  it('has nothing to say about a request with no Origin, such as curl', () => {
    expect(allowedOrigin(from(null))).toBeNull();
  });
});

describe('corsHeaders', () => {
  it('echoes the allowed origin and varies on it', () => {
    expect(corsHeaders(from(ALLOWED))).toEqual({
      'Access-Control-Allow-Origin': ALLOWED,
      Vary: 'Origin',
    });
  });

  it('omits the header entirely for a disallowed origin', () => {
    expect(corsHeaders(from(EVIL))).toEqual({});
  });

  it('never answers with a wildcard, because the token is a credential', () => {
    expect(corsHeaders(from(ALLOWED))['Access-Control-Allow-Origin']).not.toBe('*');
  });
});

describe('preflight', () => {
  it('allows the methods and headers the app actually sends', () => {
    const response = preflight(from(ALLOWED, 'OPTIONS'));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET, POST, OPTIONS');
    expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Authorization, Content-Type');
  });

  it('refuses a disallowed origin with no allow headers at all', () => {
    const response = preflight(from(EVIL, 'OPTIONS'));
    expect(response.status).toBe(403);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
