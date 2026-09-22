import { describe, expect, it } from 'vitest';
import { seasonIdFor } from './season';

const at = (iso: string) => seasonIdFor(Date.parse(iso));

describe('seasonIdFor', () => {
  it('names the week the schema comment uses as its example', () => {
    expect(at('2026-09-22T12:00:00.000Z')).toBe('2026-W39');
  });

  it('holds the whole Monday-to-Sunday week together', () => {
    // A leaderboard that reset mid-week would strand every session after it.
    const week = [
      '2026-09-21T00:00:00.000Z', // Monday
      '2026-09-23T13:45:00.000Z',
      '2026-09-27T23:59:59.999Z', // Sunday, last instant
    ];
    for (const day of week) expect(at(day)).toBe('2026-W39');
  });

  it('rolls over at Monday midnight UTC and not before', () => {
    expect(at('2026-09-27T23:59:59.999Z')).toBe('2026-W39');
    expect(at('2026-09-28T00:00:00.000Z')).toBe('2026-W40');
  });

  it('pads the week so the ids sort lexicographically', () => {
    // 'W9' would sort after 'W10', which would silently misorder any query that
    // ranges over season ids.
    expect(at('2026-03-02T00:00:00.000Z')).toBe('2026-W10');
    expect(at('2026-02-23T00:00:00.000Z')).toBe('2026-W09');
  });

  it('puts early January in the previous year when ISO 8601 says so', () => {
    // 2027-01-01 is a Friday, so its week belongs to 2026 and is week 53.
    expect(at('2027-01-01T00:00:00.000Z')).toBe('2026-W53');
    expect(at('2026-12-31T00:00:00.000Z')).toBe('2026-W53');
  });

  it('puts late December in the next year when ISO 8601 says so', () => {
    // 2024-12-30 is a Monday and its Thursday falls in 2025, so it is 2025-W01.
    expect(at('2024-12-30T00:00:00.000Z')).toBe('2025-W01');
  });

  it('starts the year at week 1, never week 0', () => {
    expect(at('2026-01-01T00:00:00.000Z')).toBe('2026-W01');
  });

  it('is UTC, so two learners in different timezones agree on the season', () => {
    // Sunday 23:30 UTC is already Monday in Stockholm. Both must say W39, or a
    // session lands in a week the snapshot for it has already been built.
    expect(at('2026-09-27T23:30:00.000Z')).toBe('2026-W39');
  });
});
