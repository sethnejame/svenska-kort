import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { SessionResult, WordStat } from '../types/progress';
import { useGameStore } from '../store/useGameStore';
import { Stats } from './Stats';

const TODAY = new Date(2026, 8, 21, 12, 0, 0);

function renderStats() {
  const router = createMemoryRouter([{ path: '/stats', element: <Stats /> }], {
    initialEntries: ['/stats'],
  });
  return render(<RouterProvider router={router} />);
}

function session(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    id: 's1',
    deckId: 'alla',
    startedAt: new Date(2026, 8, 21, 9, 0).toISOString(),
    endedAt: new Date(2026, 8, 21, 9, 10).toISOString(),
    answered: 10,
    correct: 8,
    bestStreak: 4,
    score: 100,
    ...overrides,
  };
}

function stat(entryId: string, box: WordStat['box']): WordStat {
  return {
    entryId,
    seen: 4,
    correct: 3,
    wrong: 1,
    lastSeenAt: new Date(2026, 8, 21, 9, 0).toISOString(),
    box,
    lastSeenSession: 3,
  };
}

describe('Stats', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
    useGameStore.setState({
      sessionHistory: [],
      stats: {},
      bestStreakEver: 0,
      totalScore: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks for a run instead of showing an empty chart', () => {
    renderStats();

    expect(screen.getByText(/Här dyker din statistik upp/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Spela en runda' })).toHaveAttribute(
      'href',
      '/play/alla',
    );
    expect(screen.queryByRole('heading', { name: 'Ord du kan' })).not.toBeInTheDocument();
  });

  it('reports accuracy across every run, not just the last one', () => {
    useGameStore.setState({
      sessionHistory: [
        session({ id: 'a', answered: 10, correct: 10 }),
        session({ id: 'b', answered: 10, correct: 5 }),
      ],
      bestStreakEver: 9,
      totalScore: 420,
    });
    renderStats();

    expect(screen.getByText('Rätt av svarade').parentElement).toHaveTextContent('75 %');
    expect(screen.getByText('Bästa svit').parentElement).toHaveTextContent('9');
    expect(screen.getByText('Poäng totalt').parentElement).toHaveTextContent('420');
  });

  it('counts the days practised in a row', () => {
    useGameStore.setState({
      sessionHistory: [
        session({ id: 'a', endedAt: new Date(2026, 8, 20, 9, 0).toISOString() }),
        session({ id: 'b', endedAt: new Date(2026, 8, 21, 9, 0).toISOString() }),
      ],
    });
    renderStats();

    expect(screen.getByText('Dagar i rad').parentElement).toHaveTextContent('2');
  });

  it('breaks the Leitner boxes out and names how many are mastered', () => {
    useGameStore.setState({
      sessionHistory: [session()],
      stats: { a: stat('a', 1), b: stat('b', 4), c: stat('c', 5) },
    });
    renderStats();

    const panel = screen.getByRole('region', { name: 'Ord du kan' });
    expect(panel).toHaveTextContent('2 av 3 påbörjade ord sitter');
    expect(within(panel).getAllByRole('listitem')).toHaveLength(5);
  });

  it('draws one bar per scored run, oldest first', () => {
    useGameStore.setState({
      sessionHistory: [
        session({ id: 'a', answered: 10, correct: 2 }),
        session({ id: 'b', answered: 10, correct: 9 }),
        // An abandoned run has no accuracy to plot.
        session({ id: 'c', answered: 0, correct: 0 }),
      ],
    });
    renderStats();

    const panel = screen.getByRole('region', { name: 'Träffsäkerhet per runda' });
    const bars = within(panel).getAllByRole('listitem');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('aria-label', '20 % av 10 ord');
    expect(bars[1]).toHaveAttribute('aria-label', '90 % av 10 ord');
    expect(panel).toHaveTextContent('De senaste 2 rundorna');
  });

  it('says in words how many days were practised, since the grid is decorative', () => {
    useGameStore.setState({
      sessionHistory: [
        session({ id: 'a', endedAt: new Date(2026, 8, 19, 9, 0).toISOString() }),
        session({ id: 'b', endedAt: new Date(2026, 8, 21, 9, 0).toISOString() }),
      ],
    });
    renderStats();

    // 2026-09-21 is a Monday, so twelve weeks back lands on a whole 78 days.
    expect(screen.getByRole('region', { name: 'Dagar du övat' })).toHaveTextContent(
      '2 dagar av de senaste 78',
    );
  });

  it('leads back to the decks', () => {
    renderStats();
    expect(screen.getByRole('link', { name: 'Tillbaka till lekarna' })).toHaveAttribute(
      'href',
      '/decks',
    );
  });
});
