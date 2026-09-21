import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { WordStat } from '../types/progress';
import { entriesForDeck } from '../data/decks';
import { INITIAL_GAME_STATE, useGameStore } from '../store/useGameStore';
import { INITIAL_DECK_STATE, useDeckStore } from '../store/useDeckStore';
import { Decks } from './Decks';

function renderDecks() {
  const router = createMemoryRouter(
    [
      { path: '/decks', element: <Decks /> },
      { path: '/play/:deckId', element: <div>spelar</div> },
      { path: '/profile', element: <div>profil</div> },
    ],
    { initialEntries: ['/decks'] },
  );
  return render(<RouterProvider router={router} />);
}

function mastered(deckId: string, count: number): Record<string, WordStat> {
  const stats: Record<string, WordStat> = {};
  for (const entry of entriesForDeck(deckId).slice(0, count)) {
    stats[entry.id] = {
      entryId: entry.id,
      seen: 4,
      correct: 4,
      wrong: 0,
      lastSeenAt: '',
      box: 4,
    };
  }
  return stats;
}

describe('Decks', () => {
  beforeEach(() => {
    useGameStore.setState({ ...INITIAL_GAME_STATE });
    useDeckStore.setState({ ...INITIAL_DECK_STATE });
  });

  it('renders one tile per builtin deck with its entry count', () => {
    renderDecks();

    // Every link bar the one down to `/add`.
    const tiles = screen.getAllByRole('link').filter((link) => link.textContent !== 'Lägg till ord');
    expect(tiles).toHaveLength(6);

    const expected: [string, number][] = [
      ['Nyheter och samhälle', 41],
      ['Skola och språk', 15],
      ['Vardag', 24],
      ['Fraser', 6],
      ['Verb i text', 22],
      ['Alla ord', 72],
    ];

    for (const [name, count] of expected) {
      const tile = screen.getByText(name).closest('a');
      expect(tile, name).not.toBeNull();
      if (tile) expect(within(tile).getByText(`${count} ord`)).toBeInTheDocument();
    }
  });

  it('starts every deck at zero mastered', () => {
    renderDecks();
    expect(screen.getAllByText('0 av 6 kan du')).toHaveLength(1);
  });

  it('moves the ring once words reach box 4', () => {
    useGameStore.setState({ stats: mastered('fraser', 2) });
    renderDecks();

    expect(screen.getByText('2 av 6 kan du')).toBeInTheDocument();
  });

  it('routes to the deck that was tapped', async () => {
    const user = userEvent.setup();
    renderDecks();

    await user.click(screen.getByText('Fraser'));

    expect(screen.getByText('spelar')).toBeInTheDocument();
  });

  it('says where the decks came from while the learner has none of their own', () => {
    renderDecks();

    expect(screen.getByText(/Du har inga egna ord än/)).toBeInTheDocument();
    // The note is only worth anything next to the way out of it.
    expect(screen.getByRole('link', { name: 'Lägg till ord' })).toBeInTheDocument();
  });

  it('drops the note once there are words of their own', () => {
    useDeckStore.setState({
      userEntries: [
        {
          id: 'mine-1',
          swedish: 'kanelbulle',
          english: ['cinnamon bun'],
          pos: 'noun',
          tags: ['vardag'],
        },
      ],
    });
    renderDecks();

    expect(screen.queryByText(/Du har inga egna ord än/)).not.toBeInTheDocument();
  });

  it('hides the profile link until a profile exists', () => {
    renderDecks();
    expect(screen.queryByText(/^Profil: /)).not.toBeInTheDocument();
  });

  it('links to the profile once one exists', async () => {
    useGameStore.setState({
      profile: {
        displayName: 'Seth',
        avatarSeed: 'bulle',
        createdAt: '',
        totalScore: 0,
        bestStreakEver: 0,
      },
    });

    const user = userEvent.setup();
    renderDecks();
    await user.click(screen.getByText('Profil: Seth'));

    expect(screen.getByText('profil')).toBeInTheDocument();
  });
});
