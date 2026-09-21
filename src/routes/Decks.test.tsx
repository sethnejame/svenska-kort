import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { WordStat } from '../types/progress';
import { BUILTIN_DECKS, entriesForDeck } from '../data/decks';
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
      lastSeenSession: 0,
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
    expect(tiles).toHaveLength(BUILTIN_DECKS.length);

    // Counts are read off the data rather than written out, so adding vocabulary
    // does not turn this into a list of numbers to hand-edit.
    for (const deck of BUILTIN_DECKS) {
      const tile = screen.getByText(deck.name).closest('a');
      expect(tile, deck.name).not.toBeNull();
      if (tile) {
        // Nothing has been played, so every word is due and the counts agree.
        const count = entriesForDeck(deck.id).length;
        expect(
          within(tile).getByText(`${String(count)} av ${String(count)} ord att öva nu`),
          deck.name,
        ).toBeInTheDocument();
      }
    }
  });

  it('starts every deck at zero mastered', () => {
    renderDecks();
    for (const deck of BUILTIN_DECKS) {
      const tile = screen.getByText(deck.name).closest('a');
      expect(tile, deck.name).not.toBeNull();
      const count = entriesForDeck(deck.id).length;
      if (tile) expect(within(tile).getByText(`0 av ${String(count)} kan du`)).toBeInTheDocument();
    }
  });

  it('moves the ring once words reach box 4', () => {
    useGameStore.setState({ stats: mastered('fraser', 2) });
    renderDecks();

    const tile = screen.getByText('Fraser').closest('a');
    expect(tile).not.toBeNull();
    const count = entriesForDeck('fraser').length;
    if (tile) expect(within(tile).getByText(`2 av ${String(count)} kan du`)).toBeInTheDocument();
  });

  it('counts down to what the schedule has due, and says so when nothing is', () => {
    const count = entriesForDeck('fraser').length;
    // Two words answered correctly four sessions ago sit in box 4, resting
    // eight sessions; the rest of the deck has never been seen.
    useGameStore.setState({ stats: mastered('fraser', 2), sessionCount: 4 });
    const { unmount } = renderDecks();

    const tile = screen.getByText('Fraser').closest('a');
    if (tile) {
      expect(
        within(tile).getByText(`${String(count - 2)} av ${String(count)} ord att öva nu`),
      ).toBeInTheDocument();
    }

    unmount();
    // The whole deck resting is a state the tile has to be able to say out loud.
    useGameStore.setState({ stats: mastered('fraser', count), sessionCount: 4 });
    renderDecks();

    const rested = screen.getByText('Fraser').closest('a');
    if (rested) {
      expect(within(rested).getByText(`${String(count)} ord · allt repeterat`)).toBeInTheDocument();
    }
  });

  it('hides the weakest deck until something has been missed', () => {
    useGameStore.setState({ stats: mastered('fraser', 2) });
    renderDecks();

    expect(screen.queryByText('Svagast')).not.toBeInTheDocument();
  });

  it('offers the weakest deck first, counting only the missed words', () => {
    const missed: Record<string, WordStat> = {};
    for (const entry of entriesForDeck('fraser').slice(0, 3)) {
      missed[entry.id] = {
        entryId: entry.id,
        seen: 4,
        correct: 1,
        wrong: 3,
        lastSeenAt: '',
        box: 1,
        lastSeenSession: 0,
      };
    }
    useGameStore.setState({ stats: missed });
    renderDecks();

    const tile = screen.getByText('Svagast').closest('a');
    expect(tile).not.toBeNull();
    if (tile) {
      expect(tile).toHaveAttribute('href', '/play/svagast');
      expect(within(tile).getByText('3 av 3 ord att öva nu')).toBeInTheDocument();
    }
    // It leads, because a learner who has something to repair should see it.
    expect(screen.getAllByRole('link')[0]).toBe(tile);
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
