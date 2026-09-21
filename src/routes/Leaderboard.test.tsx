import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { SessionResult } from '../types/progress';
import { INITIAL_GAME_STATE, useGameStore } from '../store/useGameStore';
import { Leaderboard } from './Leaderboard';

const PROFILE = {
  displayName: 'Seth',
  avatarSeed: 'kanel',
  createdAt: '2026-09-01T00:00:00.000Z',
  totalScore: 400,
  bestStreakEver: 7,
};

const DAY = 24 * 60 * 60 * 1000;

function session(over: Partial<SessionResult> = {}): SessionResult {
  return {
    id: 'session-a',
    deckId: 'alla',
    startedAt: new Date(Date.now() - DAY).toISOString(),
    endedAt: new Date(Date.now() - DAY).toISOString(),
    answered: 10,
    correct: 8,
    bestStreak: 4,
    score: 200,
    ...over,
  };
}

function renderBoard() {
  const router = createMemoryRouter(
    [
      { path: '/leaderboard', element: <Leaderboard /> },
      { path: '/decks', element: <div>leklista</div> },
    ],
    { initialEntries: ['/leaderboard'] },
  );
  return render(<RouterProvider router={router} />);
}

function rowTexts() {
  return screen.getAllByRole('listitem').map((item) => item.textContent ?? '');
}

async function settle() {
  await waitFor(() => {
    expect(screen.queryByLabelText('Laddar topplistan')).not.toBeInTheDocument();
  });
}

describe('Leaderboard', () => {
  beforeEach(() => {
    useGameStore.setState({ ...INITIAL_GAME_STATE });
  });

  it('reads correctly with no sessions at all', async () => {
    renderBoard();
    await settle();

    // The bundled ghosts keep the board from being blank on day one.
    expect(rowTexts()).toHaveLength(6);
    expect(rowTexts().every((text) => !text.includes('Seth'))).toBe(true);
    expect(screen.queryByText(/Din bästa placering/)).not.toBeInTheDocument();
  });

  it('puts a finished session straight onto the board', async () => {
    useGameStore.setState({ profile: PROFILE, sessionHistory: [session({ score: 999 })] });
    renderBoard();
    await settle();

    const first = screen.getAllByRole('listitem')[0];
    expect(first).toHaveTextContent('1');
    expect(first).toHaveTextContent('Seth');
    expect(first).toHaveTextContent('999');
    expect(first).toHaveTextContent('4 i rad');
  });

  it('marks the learner own row and nobody else', async () => {
    useGameStore.setState({ profile: PROFILE, sessionHistory: [session({ score: 999 })] });
    const { container } = renderBoard();
    await settle();

    const highlighted = container.querySelectorAll('li[class*="me"]');
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0]).toHaveTextContent('Seth');
  });

  it('keeps a six-day-old run in the week but drops an eight-day-old one', async () => {
    const user = userEvent.setup();
    useGameStore.setState({
      profile: PROFILE,
      sessionHistory: [
        session({ id: 'recent', score: 111, endedAt: new Date(Date.now() - 6 * DAY).toISOString() }),
        session({ id: 'stale', score: 222, endedAt: new Date(Date.now() - 8 * DAY).toISOString() }),
      ],
    });
    renderBoard();
    await settle();

    expect(rowTexts().join(' ')).toContain('222');

    await user.click(screen.getByRole('tab', { name: 'Denna vecka' }));
    await settle();

    const week = rowTexts().join(' ');
    expect(week).toContain('111');
    expect(week).not.toContain('222');
  });

  it('shows fifty runs without losing the ranking', async () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      session({ id: `s-${i}`, score: i * 10, endedAt: new Date(Date.now() - DAY).toISOString() }),
    );
    useGameStore.setState({ profile: PROFILE, sessionHistory: many });
    renderBoard();
    await settle();

    const items = screen.getAllByRole('listitem');
    // Capped at the top twenty, best first. Verb-Viktor's 620 still leads.
    expect(items).toHaveLength(20);
    expect(items[0]).toHaveTextContent('Verb-Viktor');
    expect(items[1]).toHaveTextContent('490');
    expect(within(items[1] as HTMLElement).getByText('2')).toBeInTheDocument();
  });

  it('leaves the footer off when the learner is already visible', async () => {
    useGameStore.setState({ profile: PROFILE, sessionHistory: [session({ score: 999 })] });
    renderBoard();
    await settle();

    expect(screen.queryByText(/Din bästa placering/)).not.toBeInTheDocument();
  });
});

describe('Leaderboard with a slow store', () => {
  beforeEach(() => {
    useGameStore.setState({ ...INITIAL_GAME_STATE });
    vi.resetModules();
  });

  it('shows the skeleton first and the rows after, with no component changes', async () => {
    vi.doMock('../services/scoreStore', () => ({
      scoreStore: {
        topScores: () =>
          new Promise((resolve) => {
            setTimeout(
              () =>
                resolve([
                  {
                    rank: 1,
                    displayName: 'Långsam Lena',
                    avatarSeed: 'sen',
                    score: 42,
                    bestStreak: 2,
                    achievedAt: new Date().toISOString(),
                    isMe: false,
                  },
                ]),
              500,
            );
          }),
        myRank: () => new Promise((resolve) => setTimeout(() => resolve(null), 500)),
      },
    }));

    const { Leaderboard: Slow } = await import('./Leaderboard');
    const router = createMemoryRouter([{ path: '/', element: <Slow /> }], { initialEntries: ['/'] });
    render(<RouterProvider router={router} />);

    expect(screen.getByLabelText('Laddar topplistan')).toHaveAttribute('aria-busy', 'true');

    await waitFor(
      () => {
        expect(screen.getByText('Långsam Lena')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    expect(screen.queryByLabelText('Laddar topplistan')).not.toBeInTheDocument();

    vi.doUnmock('../services/scoreStore');
  });

  /**
   * Six ghosts plus the learner's own runs can never push their best placing
   * past twenty, so this only becomes reachable once the board has other
   * people on it. The component still has to handle it.
   */
  it('puts the learner rank in a footer when it falls off the visible list', async () => {
    vi.doMock('../services/scoreStore', () => ({
      scoreStore: {
        topScores: () => Promise.resolve([]),
        myRank: () => Promise.resolve(87),
      },
    }));

    const { Leaderboard: Crowded } = await import('./Leaderboard');
    const router = createMemoryRouter([{ path: '/', element: <Crowded /> }], {
      initialEntries: ['/'],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText('Din bästa placering: 87')).toBeInTheDocument();

    vi.doUnmock('../services/scoreStore');
  });

  it('says so when the store gives up', async () => {
    vi.doMock('../services/scoreStore', () => ({
      scoreStore: {
        topScores: () => Promise.reject(new Error('nej')),
        myRank: () => Promise.resolve(null),
      },
    }));

    const { Leaderboard: Broken } = await import('./Leaderboard');
    const router = createMemoryRouter([{ path: '/', element: <Broken /> }], {
      initialEntries: ['/'],
    });
    render(<RouterProvider router={router} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('gick inte att hämta');

    vi.doUnmock('../services/scoreStore');
  });
});
