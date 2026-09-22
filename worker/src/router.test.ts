import { describe, expect, it } from 'vitest';
import { lookup, type Route } from './router';

const ok = () => new Response('ok');

const routes: readonly Route<unknown>[] = [
  { method: 'GET', path: '/api/health', handler: ok },
  { method: 'GET', path: '/api/decks/shared/:id', handler: ok },
  { method: 'POST', path: '/api/session', handler: ok },
];

function get(url: string, method = 'GET'): Request {
  return new Request(url, { method });
}

describe('lookup', () => {
  it('matches a literal path', () => {
    const { matched } = lookup(routes, get('https://api.test/api/health'));
    expect(matched?.params).toEqual({});
  });

  it('ignores the query string', () => {
    const { matched } = lookup(routes, get('https://api.test/api/health?scope=week'));
    expect(matched).not.toBeNull();
  });

  it('tolerates a trailing slash rather than 404ing on one', () => {
    const { matched } = lookup(routes, get('https://api.test/api/health/'));
    expect(matched).not.toBeNull();
  });

  it('captures a single named parameter', () => {
    const { matched } = lookup(routes, get('https://api.test/api/decks/shared/ABCD2345'));
    expect(matched?.params).toEqual({ id: 'ABCD2345' });
  });

  it('decodes a parameter, so an encoded slash cannot smuggle a segment', () => {
    const { matched } = lookup(routes, get('https://api.test/api/decks/shared/a%2Fb'));
    expect(matched?.params).toEqual({ id: 'a/b' });
  });

  it('does not let a parameter swallow extra segments', () => {
    const { matched } = lookup(routes, get('https://api.test/api/decks/shared/a/b'));
    expect(matched).toBeNull();
  });

  it('refuses a path that stops short of the pattern', () => {
    const { matched } = lookup(routes, get('https://api.test/api/decks/shared'));
    expect(matched).toBeNull();
  });

  it('reports an unknown path as a plain miss', () => {
    const { matched, methodMismatch } = lookup(routes, get('https://api.test/api/nope'));
    expect(matched).toBeNull();
    expect(methodMismatch).toBe(false);
  });

  it('distinguishes a wrong method from an unknown path', () => {
    const { matched, methodMismatch } = lookup(routes, get('https://api.test/api/session', 'GET'));
    expect(matched).toBeNull();
    expect(methodMismatch).toBe(true);
  });

  it('matches the right method when a path has more than one', () => {
    const both: readonly Route<unknown>[] = [
      { method: 'GET', path: '/api/thing', handler: () => new Response('get') },
      { method: 'POST', path: '/api/thing', handler: () => new Response('post') },
    ];
    const { matched } = lookup(both, get('https://api.test/api/thing', 'POST'));
    expect(matched).not.toBeNull();
  });
});
