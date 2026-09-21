import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { useGameStore } from '../store/useGameStore';
import { Play } from './Play';

function renderPlay(path = '/play/nyheter') {
  const router = createMemoryRouter([{ path: '/play/:deckId', element: <Play /> }], {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

/** Forces a known card so the assertions do not depend on the weighted draw. */
function showCard(entryId: string) {
  act(() => {
    useGameStore.setState({
      status: 'prompt',
      currentId: entryId,
      pool: [entryId],
      flipped: false,
      peeked: false,
      retryUsed: false,
      input: '',
      lastVerdict: null,
      promptShownAt: Date.now(),
    });
  });
}

/** jsdom ships no speech synthesis, so a Swedish voice has to be invented. */
function stubVoice(spoken: { text: string }[]) {
  vi.stubGlobal('speechSynthesis', {
    getVoices: () => [{ lang: 'sv-SE', name: 'Alva' }],
    addEventListener: () => {},
    removeEventListener: () => {},
    cancel: () => {},
    speak: (utterance: { text: string }) => spoken.push(utterance),
  });
  vi.stubGlobal(
    'SpeechSynthesisUtterance',
    class {
      lang = '';
      rate = 1;
      voice: unknown = null;
      constructor(public text: string) {}
    },
  );
}

describe('Play', () => {
  beforeEach(() => {
    useGameStore.setState({ rng: () => 0.5, reverse: false });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders the deck name, a card and the three actions', () => {
    renderPlay();

    expect(screen.getByText('Nyheter och samhälle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Kolla' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vänd' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hoppa' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(useGameStore.getState().status).toBe('prompt');
  });

  it('starts the session named in the route', () => {
    renderPlay('/play/fraser');

    expect(screen.getByText('Fraser')).toBeInTheDocument();
    expect(useGameStore.getState().deckId).toBe('fraser');
  });

  it('scores a correct answer typed with the keyboard alone', async () => {
    const user = userEvent.setup();
    renderPlay();
    showCard('minska-verb');

    // Tab order follows the visual order: the card first, then the input.
    await user.tab();
    expect(screen.getByRole('button', { name: /minskade/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('textbox')).toHaveFocus();

    await user.keyboard('decreased{Enter}');

    await waitFor(() => expect(useGameStore.getState().correct).toBe(1));
    expect(useGameStore.getState().sessionScore).toBeGreaterThan(0);
  });

  it('shows the diff and lets the retry score after a near miss', async () => {
    const user = userEvent.setup();
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('decresed{Enter}');

    expect(useGameStore.getState().status).toBe('close');
    expect(screen.getByText(/Nästan/)).toBeInTheDocument();
    const marks = screen.getAllByRole('mark');
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent('a');
    expect(screen.getByRole('textbox')).toHaveFocus();

    await user.clear(screen.getByRole('textbox'));
    await user.keyboard('decreased{Enter}');

    await waitFor(() => expect(useGameStore.getState().correct).toBe(1));
    expect(useGameStore.getState().sessionScore).toBe(10);
  });

  it('marks "increased" for "minskade" wrong rather than close', async () => {
    const user = userEvent.setup();
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('increased{Enter}');

    expect(useGameStore.getState().status).toBe('revealed');
    expect(screen.getByText(/Inte riktigt/)).toBeInTheDocument();
    expect(screen.queryByRole('mark')).not.toBeInTheDocument();
  });

  it('flips a wrong card, holds, and only then offers Continue', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('increased{Enter}');

    expect(useGameStore.getState().flipped).toBe(true);
    const continueButton = screen.getByRole('button', { name: 'Fortsätt' });
    expect(continueButton).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Kolla' })).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.getByRole('button', { name: 'Fortsätt' })).toBeEnabled();
  });

  it('flips the focused card with Space and advances a revealed card with Enter', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlay();
    showCard('minska-verb');

    await user.tab();
    await user.keyboard(' ');
    expect(useGameStore.getState().flipped).toBe(true);

    useGameStore.setState({ pool: ['minska-verb', 'oka-verb'] });
    await user.tab();
    await user.keyboard('increased{Enter}');
    expect(useGameStore.getState().status).toBe('revealed');

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    await user.keyboard('{Enter}');

    expect(useGameStore.getState().status).toBe('prompt');
    expect(useGameStore.getState().currentId).toBe('oka-verb');
  });

  it('advances a revealed card on a horizontal swipe but not on a tap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('textbox'));
    await user.keyboard('increased{Enter}');
    act(() => {
      vi.advanceTimersByTime(1200);
    });

    const card = screen.getByRole('button', { name: /minskade/ });
    const band = card.parentElement;
    if (!band) throw new Error('card has no band');

    // A tap: no travel, so the card flips instead of advancing.
    const flippedBefore = useGameStore.getState().flipped;
    fireEvent.pointerDown(band, { clientX: 100, clientY: 200 });
    fireEvent.pointerUp(band, { clientX: 103, clientY: 202 });
    fireEvent.click(card);
    expect(useGameStore.getState().status).toBe('revealed');
    expect(useGameStore.getState().flipped).toBe(!flippedBefore);

    useGameStore.setState({ pool: ['minska-verb', 'oka-verb'] });
    fireEvent.pointerDown(band, { clientX: 200, clientY: 200 });
    fireEvent.pointerUp(band, { clientX: 140, clientY: 208 });

    expect(useGameStore.getState().status).toBe('prompt');
  });

  it('flips the card from the Vänd button and marks it peeked', async () => {
    const user = userEvent.setup();
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('button', { name: 'Vänd' }));

    expect(useGameStore.getState().flipped).toBe(true);
    expect(useGameStore.getState().peeked).toBe(true);
  });

  it('skips to the revealed state without scoring', async () => {
    const user = userEvent.setup();
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('button', { name: 'Hoppa' }));

    expect(useGameStore.getState().status).toBe('revealed');
    expect(useGameStore.getState().sessionScore).toBe(0);
  });

  it('offers no speaker when the browser has no Swedish voice', () => {
    renderPlay();
    showCard('minska-verb');
    expect(screen.queryByRole('button', { name: /^Hör / })).not.toBeInTheDocument();
  });

  it('speaks the Swedish word from the card', async () => {
    const spoken: { text: string }[] = [];
    stubVoice(spoken);
    const user = userEvent.setup();
    renderPlay();
    showCard('minska-verb');

    await user.click(screen.getByRole('button', { name: 'Hör minskade' }));
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toMatchObject({ text: 'minskade' });
  });

  it('withholds the speaker in reverse until the card has been turned', () => {
    stubVoice([]);
    renderPlay();
    act(() => {
      useGameStore.setState({ reverse: true });
    });
    showCard('minska-verb');

    expect(screen.queryByRole('button', { name: /^Hör / })).not.toBeInTheDocument();

    act(() => {
      useGameStore.setState({ flipped: true });
    });
    expect(screen.getByRole('button', { name: 'Hör minskade' })).toBeInTheDocument();
  });

  it('shows the Klart panel with the session summary when the deck runs out', () => {
    renderPlay();
    act(() => {
      useGameStore.setState({
        status: 'done',
        answered: 7,
        correct: 5,
        bestStreakInSession: 4,
        sessionScore: 85,
      });
    });

    expect(screen.getByRole('heading', { name: 'Klart!' })).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('85')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Välj en annan lek' })).toHaveAttribute(
      'href',
      '/decks',
    );
  });
});
