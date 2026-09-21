import { describe, expect, it } from 'vitest';
import type { Deck, Profile, SessionResult, WordStat } from '../types/progress';
import type { WordEntry } from '../types/word';
import {
  BACKUP_SCHEMA_VERSION,
  backupFilename,
  buildBackup,
  describeIssues,
  mergeBackup,
  readBackup,
  replaceWith,
  summarize,
} from './backup';
import type { BackupContents, BackupFile } from './backup';

const ENTRY: WordEntry = {
  id: 'regering-noun',
  swedish: 'regering',
  english: ['government'],
  pos: 'noun',
};

const DECK: Deck = {
  id: 'mina-ord',
  name: 'Mina ord',
  description: '',
  source: 'user',
  entryIds: ['regering-noun'],
  createdAt: '2026-09-01T00:00:00.000Z',
};

const PROFILE: Profile = {
  displayName: 'Seth',
  avatarSeed: 'kanel',
  createdAt: '2026-09-01T00:00:00.000Z',
  totalScore: 400,
  bestStreakEver: 7,
};

function stat(over: Partial<WordStat> = {}): WordStat {
  return {
    entryId: 'regering-noun',
    seen: 3,
    correct: 2,
    wrong: 1,
    lastSeenAt: '2026-09-10T00:00:00.000Z',
    box: 2,
    lastSeenSession: 3,
    ...over,
  };
}

function session(over: Partial<SessionResult> = {}): SessionResult {
  return {
    id: 'session-a',
    deckId: 'alla',
    startedAt: '2026-09-10T00:00:00.000Z',
    endedAt: '2026-09-10T00:10:00.000Z',
    answered: 10,
    correct: 8,
    bestStreak: 4,
    score: 120,
    ...over,
  };
}

function contents(over: Partial<BackupContents> = {}): BackupContents {
  return {
    profile: null,
    userEntries: [],
    userDecks: [],
    stats: {},
    sessionHistory: [],
    ...over,
  };
}

const FULL: BackupContents = contents({
  profile: PROFILE,
  userEntries: [ENTRY],
  userDecks: [DECK],
  stats: { 'regering-noun': stat() },
  sessionHistory: [session()],
});

function roundTrip(input: BackupContents = FULL): BackupFile {
  const result = readBackup(JSON.stringify(buildBackup(input, Date.parse('2026-09-20T09:00:00Z'))));
  if (!result.ok) throw new Error(result.error);
  return result.backup;
}

describe('buildBackup', () => {
  it('stamps the version and the moment it was taken', () => {
    const backup = buildBackup(FULL, Date.parse('2026-09-20T09:00:00Z'));
    expect(backup).toMatchObject({
      schemaVersion: BACKUP_SCHEMA_VERSION,
      exportedAt: '2026-09-20T09:00:00.000Z',
      profile: PROFILE,
      userEntries: [ENTRY],
      userDecks: [DECK],
      sessionHistory: [session()],
    });
  });

  it('survives a round trip through JSON', () => {
    expect(roundTrip()).toEqual(buildBackup(FULL, Date.parse('2026-09-20T09:00:00Z')));
  });
});

describe('backupFilename', () => {
  it('carries the date, zero padded', () => {
    expect(backupFilename(new Date(2026, 0, 5, 12).getTime())).toBe(
      'svenska-kort-export-2026-01-05.json',
    );
  });

  it('uses two digits for a late month and day', () => {
    expect(backupFilename(new Date(2026, 10, 30, 12).getTime())).toBe(
      'svenska-kort-export-2026-11-30.json',
    );
  });
});

describe('readBackup', () => {
  it('rejects something that is not JSON at all', () => {
    expect(readBackup('not json')).toEqual({ ok: false, error: 'Filen är inte giltig JSON.' });
  });

  it('rejects JSON that is not a backup', () => {
    const result = readBackup('[]');
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.error).toMatch(/fel format/);
  });

  it('names the entry that is wrong and imports nothing', () => {
    const backup = buildBackup(FULL, 0) as unknown as { userEntries: unknown[] };
    backup.userEntries = [ENTRY, { ...ENTRY, id: 'hus-noun', english: [] }];

    const result = readBackup(JSON.stringify(backup));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toBe(
      'Fel i userEntries[1].english: english needs at least one accepted answer',
    );
  });

  it('points at a stat by its key', () => {
    const backup = buildBackup(FULL, 0) as unknown as { stats: Record<string, unknown> };
    backup.stats = { 'regering-noun': { ...stat(), box: 9 } };

    const result = readBackup(JSON.stringify(backup));
    expect(result.ok ? '' : result.error).toMatch(/^Fel i stats\.regering-noun\.box: /);
  });

  it('reports a missing top-level field by name', () => {
    const backup = buildBackup(FULL, 0) as unknown as Record<string, unknown>;
    delete backup['exportedAt'];

    const result = readBackup(JSON.stringify(backup));
    expect(result.ok ? '' : result.error).toMatch(/^Fel i exportedAt:/);
  });

  it('takes a file exported before the schedule existed', () => {
    const backup = buildBackup(FULL, 0) as unknown as { stats: Record<string, unknown> };
    const old = { ...stat() } as Partial<WordStat>;
    delete old.lastSeenSession;
    backup.stats = { 'regering-noun': old };

    const result = readBackup(JSON.stringify(backup));
    // Session 0 is the oldest there is, so the word arrives due.
    expect(result.ok && result.backup.stats['regering-noun']?.lastSeenSession).toBe(0);
  });

  it('reports a whole-file shape problem with no path to point at', () => {
    const result = readBackup('42');
    expect(result.ok ? '' : result.error).toMatch(/^Filen har fel format: /);
  });
});

describe('describeIssues', () => {
  it('falls back to a plain refusal when the parser said nothing', () => {
    expect(describeIssues([])).toBe('Filen har fel format.');
  });
});

describe('summarize', () => {
  it('counts what the learner is about to take on', () => {
    expect(summarize(roundTrip())).toEqual({ words: 1, decks: 1, stats: 1, sessions: 1 });
  });
});

describe('mergeBackup', () => {
  it('keeps what is only on one side', () => {
    const current = contents({ userEntries: [{ ...ENTRY, id: 'hus-noun', swedish: 'hus' }] });
    const merged = mergeBackup(current, roundTrip());
    expect(merged.userEntries.map((entry) => entry.id)).toEqual(['hus-noun', 'regering-noun']);
  });

  it('lets the incoming entry win a clash of ids', () => {
    const current = contents({ userEntries: [{ ...ENTRY, english: ['cabinet'] }] });
    const merged = mergeBackup(current, roundTrip());
    expect(merged.userEntries).toEqual([ENTRY]);
  });

  it('lets the incoming deck win a clash of ids', () => {
    const current = contents({ userDecks: [{ ...DECK, name: 'Gamla' }] });
    expect(mergeBackup(current, roundTrip()).userDecks).toEqual([DECK]);
  });

  it('sums the counts and takes the later sighting', () => {
    const current = contents({
      stats: { 'regering-noun': stat({ seen: 5, correct: 5, wrong: 0, box: 4 }) },
    });
    const incoming = roundTrip(
      contents({
        stats: {
          'regering-noun': stat({
            lastSeenAt: '2026-09-15T00:00:00.000Z',
            box: 1,
            lastSeenSession: 9,
          }),
        },
      }),
    );

    expect(mergeBackup(current, incoming).stats['regering-noun']).toEqual({
      entryId: 'regering-noun',
      seen: 8,
      correct: 7,
      wrong: 1,
      lastSeenAt: '2026-09-15T00:00:00.000Z',
      box: 1,
      // The higher session count wins, so a word does not come round early
      // just because the two devices counted a different number of runs.
      lastSeenSession: 9,
    });
  });

  it('keeps the box the learner earned most recently when ours is later', () => {
    const current = contents({
      stats: { 'regering-noun': stat({ lastSeenAt: '2026-09-18T00:00:00.000Z', box: 5 }) },
    });
    const incoming = roundTrip(contents({ stats: { 'regering-noun': stat({ box: 1 }) } }));

    expect(mergeBackup(current, incoming).stats['regering-noun']).toMatchObject({
      lastSeenAt: '2026-09-18T00:00:00.000Z',
      box: 5,
    });
  });

  it('takes a stat the learner has never seen as it comes', () => {
    expect(mergeBackup(contents(), roundTrip()).stats).toEqual({ 'regering-noun': stat() });
  });

  it('does not duplicate words, decks or sessions when the same file comes back', () => {
    const merged = mergeBackup(FULL, roundTrip());
    expect(merged.userEntries).toEqual(FULL.userEntries);
    expect(merged.userDecks).toEqual(FULL.userDecks);
    expect(merged.sessionHistory).toEqual(FULL.sessionHistory);
  });

  it('keeps the newest fifty sessions in order', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      session({ id: `old-${i}`, endedAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}` }),
    );
    const merged = mergeBackup(
      contents({ sessionHistory: many }),
      roundTrip(contents({ sessionHistory: [session({ id: 'new', endedAt: '2027-01-01' })] })),
    );

    expect(merged.sessionHistory).toHaveLength(50);
    expect(merged.sessionHistory.at(-1)?.id).toBe('new');
  });

  it('takes the incoming profile but never lowers the career totals', () => {
    const current = contents({ profile: { ...PROFILE, totalScore: 900, bestStreakEver: 2 } });
    const incoming = roundTrip(contents({ profile: { ...PROFILE, displayName: 'Seth på resa' } }));

    expect(mergeBackup(current, incoming).profile).toEqual({
      ...PROFILE,
      displayName: 'Seth på resa',
      totalScore: 900,
      bestStreakEver: 7,
    });
  });

  it('keeps the learner signed in when the file has no profile', () => {
    const incoming = roundTrip(contents());
    expect(mergeBackup(contents({ profile: PROFILE }), incoming).profile).toEqual(PROFILE);
  });

  it('adopts the profile when there is nobody signed in', () => {
    expect(mergeBackup(contents(), roundTrip()).profile).toEqual(PROFILE);
  });
});

describe('replaceWith', () => {
  it('hands back only what the file carried', () => {
    expect(replaceWith(roundTrip())).toEqual(FULL);
  });

  it('trims an overlong history from a hand-rolled file', () => {
    const many = Array.from({ length: 60 }, (_, i) => session({ id: `s-${i}` }));
    expect(replaceWith(roundTrip(contents({ sessionHistory: many }))).sessionHistory).toHaveLength(
      50,
    );
  });
});
