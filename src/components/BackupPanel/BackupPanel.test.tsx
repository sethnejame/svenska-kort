import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Profile, WordStat } from '../../types/progress';
import type { WordEntry } from '../../types/word';
import { INITIAL_DECK_STATE, useDeckStore } from '../../store/useDeckStore';
import { INITIAL_GAME_STATE, useGameStore } from '../../store/useGameStore';
import { buildBackup } from '../../lib/backup';
import { BackupPanel } from './BackupPanel';

const ENTRY: WordEntry = {
  id: 'regering-noun',
  swedish: 'regering',
  english: ['government'],
  pos: 'noun',
};

const PROFILE: Profile = {
  displayName: 'Seth',
  avatarSeed: 'kanel',
  createdAt: '2026-09-01T00:00:00.000Z',
  totalScore: 400,
  bestStreakEver: 7,
};

const STAT: WordStat = {
  entryId: 'regering-noun',
  seen: 3,
  correct: 2,
  wrong: 1,
  lastSeenAt: '2026-09-10T00:00:00.000Z',
  box: 2,
};

const BACKUP_TEXT = JSON.stringify(
  buildBackup(
    {
      profile: PROFILE,
      userEntries: [ENTRY],
      userDecks: [],
      stats: { 'regering-noun': STAT },
      sessionHistory: [],
    },
    Date.parse('2026-09-20T09:00:00Z'),
  ),
);

async function pickFile(user: ReturnType<typeof userEvent.setup>, text: string) {
  const file = new File([text], 'backup.json', { type: 'application/json' });
  await user.upload(screen.getByLabelText('Importera från fil'), file);
  // FileReader resolves a tick after the change event, with either the
  // summary to confirm or the complaint about the file.
  await waitFor(() => {
    expect(screen.queryByRole('status') ?? screen.queryByRole('alert')).not.toBeNull();
  });
}

function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(typeof reader.result === 'string' ? reader.result : '');
    };
    reader.readAsText(blob);
  });
}

describe('BackupPanel', () => {
  beforeEach(() => {
    useDeckStore.setState({ ...INITIAL_DECK_STATE });
    useGameStore.setState({ ...INITIAL_GAME_STATE });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('downloads a file named for today', async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date(2026, 8, 20, 10));
    const createObjectURL = vi.fn(() => 'blob:fake');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clicked: { download: string; href: string }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ download: this.download, href: this.href });
    });

    useDeckStore.setState({ userEntries: [ENTRY] });
    render(<BackupPanel />);
    await user.click(screen.getByRole('button', { name: 'Exportera till fil' }));

    expect(clicked).toEqual([{ download: 'svenska-kort-export-2026-09-20.json', href: 'blob:fake' }]);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');
    });
  });

  it('shows the counts and writes nothing before the learner chooses', async () => {
    const user = userEvent.setup();
    render(<BackupPanel />);

    await pickFile(user, BACKUP_TEXT);

    expect(screen.getByRole('status')).toHaveTextContent(
      '1 ord, 0 listor, 1 statistikrader, 0 omgångar.',
    );
    expect(useDeckStore.getState().userEntries).toEqual([]);
    expect(useGameStore.getState().stats).toEqual({});
  });

  it('merges on one press', async () => {
    const user = userEvent.setup();
    useDeckStore.setState({ userEntries: [{ ...ENTRY, id: 'hus-noun', swedish: 'hus' }] });
    render(<BackupPanel />);

    await pickFile(user, BACKUP_TEXT);
    await user.click(screen.getByRole('button', { name: 'Slå ihop' }));

    expect(useDeckStore.getState().userEntries.map((entry) => entry.id)).toEqual([
      'hus-noun',
      'regering-noun',
    ]);
    expect(useGameStore.getState().profile).toEqual(PROFILE);
    expect(screen.getByRole('status')).toHaveTextContent('Sammanfogat. Du har nu 2 egna ord.');
  });

  it('asks a second time before replacing', async () => {
    const user = userEvent.setup();
    useDeckStore.setState({ userEntries: [{ ...ENTRY, id: 'hus-noun', swedish: 'hus' }] });
    render(<BackupPanel />);

    await pickFile(user, BACKUP_TEXT);
    await user.click(screen.getByRole('button', { name: 'Ersätt allt' }));

    // Still untouched after the first press.
    expect(useDeckStore.getState().userEntries).toHaveLength(1);
    expect(screen.getByRole('alert')).toHaveTextContent('Säkert?');

    await user.click(screen.getByRole('button', { name: 'Ja, ersätt allt' }));

    expect(useDeckStore.getState().userEntries.map((entry) => entry.id)).toEqual([
      'regering-noun',
    ]);
    expect(useGameStore.getState().totalScore).toBe(400);
  });

  it('backs out of a replace without touching anything', async () => {
    const user = userEvent.setup();
    useDeckStore.setState({ userEntries: [{ ...ENTRY, id: 'hus-noun', swedish: 'hus' }] });
    render(<BackupPanel />);

    await pickFile(user, BACKUP_TEXT);
    await user.click(screen.getByRole('button', { name: 'Ersätt allt' }));
    await user.click(screen.getByRole('button', { name: 'Avbryt' }));

    expect(useDeckStore.getState().userEntries.map((entry) => entry.id)).toEqual(['hus-noun']);
    expect(screen.getByRole('button', { name: 'Slå ihop' })).toBeInTheDocument();
  });

  it('names the bad entry and imports nothing', async () => {
    const user = userEvent.setup();
    render(<BackupPanel />);

    const broken = JSON.parse(BACKUP_TEXT) as { userEntries: unknown[] };
    broken.userEntries = [{ ...ENTRY, english: [] }];
    await pickFile(user, JSON.stringify(broken));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Fel i userEntries[0].english: english needs at least one accepted answer Inget importerades.',
    );
    expect(screen.queryByRole('button', { name: 'Slå ihop' })).not.toBeInTheDocument();
    expect(useDeckStore.getState().userEntries).toEqual([]);
  });

  it('refuses a file that is not json', async () => {
    const user = userEvent.setup();
    render(<BackupPanel />);

    await pickFile(user, 'hej hej');

    expect(screen.getByRole('alert')).toHaveTextContent('Filen är inte giltig JSON.');
  });

  it('round trips an export back into an empty browser', async () => {
    const user = userEvent.setup();
    useGameStore.setState({ profile: PROFILE, stats: { 'regering-noun': STAT } });
    useDeckStore.setState({ userEntries: [ENTRY] });

    let written: Promise<string> | null = null;
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: (blob: Blob) => {
        written = blobText(blob);
        return 'blob:fake';
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    render(<BackupPanel />);
    await user.click(screen.getByRole('button', { name: 'Exportera till fil' }));

    expect(written).not.toBeNull();
    const exported = await (written as unknown as Promise<string>);

    useDeckStore.setState({ ...INITIAL_DECK_STATE });
    useGameStore.setState({ ...INITIAL_GAME_STATE });

    await pickFile(user, exported);
    await user.click(screen.getByRole('button', { name: 'Slå ihop' }));

    expect(useDeckStore.getState().userEntries).toEqual([ENTRY]);
    expect(useGameStore.getState().stats).toEqual({ 'regering-noun': STAT });
    expect(useGameStore.getState().profile).toEqual(PROFILE);
  });
});
