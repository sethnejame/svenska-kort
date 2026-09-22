import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { displayNameSchema, firstIssue, healthResponseSchema, normalizeDisplayName } from './api';

describe('normalizeDisplayName', () => {
  it('trims and collapses so the length both sides measure is the same one', () => {
    expect(normalizeDisplayName('  Anna   Karin  ')).toBe('Anna Karin');
  });

  it('leaves an already-tidy name alone', () => {
    expect(normalizeDisplayName('Åsa')).toBe('Åsa');
  });
});

describe('displayNameSchema', () => {
  it('accepts a Swedish name with the letters that make it Swedish', () => {
    expect(displayNameSchema.parse('Åsa Öberg')).toBe('Åsa Öberg');
  });

  it('normalizes before it measures, so padding cannot smuggle length', () => {
    expect(displayNameSchema.parse('   Bo   ')).toBe('Bo');
  });

  it('refuses a name shorter than the floor', () => {
    expect(displayNameSchema.safeParse('A').success).toBe(false);
  });

  it('refuses a 21-character name, and accepts a 20-character one', () => {
    expect(displayNameSchema.safeParse('A'.repeat(20)).success).toBe(true);
    expect(displayNameSchema.safeParse('A'.repeat(21)).success).toBe(false);
  });

  it('refuses control, zero-width and bidi-override characters', () => {
    expect(displayNameSchema.safeParse('An\u0000na').success).toBe(false);
    expect(displayNameSchema.safeParse('An\u200Bna').success).toBe(false);
    expect(displayNameSchema.safeParse('An\u202Ena').success).toBe(false);
  });

  it('refuses a name that would render as a blank leaderboard row', () => {
    expect(displayNameSchema.safeParse('...').success).toBe(false);
    expect(displayNameSchema.safeParse('!!').success).toBe(false);
  });

  it('accepts a name that is only digits, which is a real choice', () => {
    expect(displayNameSchema.safeParse('123').success).toBe(true);
  });
});

describe('firstIssue', () => {
  it('returns the message a learner can act on', () => {
    const error = displayNameSchema.safeParse('A'.repeat(21)).error;
    expect(error).toBeDefined();
    expect(firstIssue(error as z.ZodError)).toMatch(/högst 20 tecken/);
  });

  it('falls back rather than returning undefined when there are no issues', () => {
    // zod does not produce an issue-free error, but the fallback is cheaper to
    // write than to prove impossible, and an empty message is a dead-end dialog.
    expect(firstIssue(new z.ZodError([]))).toBe('Något i formuläret gick inte att läsa.');
  });
});

describe('healthResponseSchema', () => {
  it('accepts the shape the Worker returns', () => {
    expect(healthResponseSchema.parse({ ok: true, version: 'abc1234' })).toEqual({
      ok: true,
      version: 'abc1234',
    });
  });

  it('refuses a body that is merely truthy', () => {
    expect(healthResponseSchema.safeParse({ ok: 'yes', version: 'abc1234' }).success).toBe(false);
  });
});
