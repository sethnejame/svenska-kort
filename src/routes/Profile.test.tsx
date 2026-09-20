import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { INITIAL_GAME_STATE, useGameStore } from '../store/useGameStore';
import { Profile } from './Profile';

function renderProfile() {
  const router = createMemoryRouter(
    [
      { path: '/profile', element: <Profile /> },
      { path: '/decks', element: <div>leklista</div> },
    ],
    { initialEntries: ['/profile'] },
  );
  return render(<RouterProvider router={router} />);
}

describe('Profile', () => {
  beforeEach(() => {
    useGameStore.setState({ ...INITIAL_GAME_STATE });
  });

  it('greets a first-time learner and asks for a name once', async () => {
    const user = userEvent.setup();
    renderProfile();

    expect(screen.getByText('Hej! Vem är du?')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Visningsnamn'), 'Seth');
    await user.click(screen.getByRole('button', { name: 'Kör igång' }));

    expect(screen.getByText('leklista')).toBeInTheDocument();
    expect(useGameStore.getState().profile?.displayName).toBe('Seth');
  });

  it('rejects a whitespace-only name with a visible message', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText('Visningsnamn'), '   ');
    await user.click(screen.getByRole('button', { name: 'Kör igång' }));

    expect(screen.getByRole('alert')).toHaveTextContent('minst 2 tecken');
    expect(useGameStore.getState().profile).toBeNull();
    expect(screen.getByLabelText('Visningsnamn')).toHaveAttribute('aria-invalid', 'true');
  });

  it('clears the message as soon as the learner types again', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.click(screen.getByRole('button', { name: 'Kör igång' }));
    expect(screen.getByRole('alert')).toBeVisible();

    await user.type(screen.getByLabelText('Visningsnamn'), 'S');
    // `hidden` takes it out of the accessibility tree, not just out of view.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('trims the stored name', async () => {
    const user = userEvent.setup();
    renderProfile();

    await user.type(screen.getByLabelText('Visningsnamn'), '  Astrid  ');
    await user.click(screen.getByRole('button', { name: 'Kör igång' }));

    expect(useGameStore.getState().profile?.displayName).toBe('Astrid');
  });

  it('saves whichever figure was picked', async () => {
    const user = userEvent.setup();
    renderProfile();

    const choices = screen.getAllByRole('button', { pressed: false });
    const third = choices[2];
    expect(third).toBeDefined();
    if (!third) return;

    await user.click(third);
    expect(third).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByLabelText('Visningsnamn'), 'Seth');
    await user.click(screen.getByRole('button', { name: 'Kör igång' }));

    const seed = useGameStore.getState().profile?.avatarSeed;
    expect(third.textContent).toContain(seed);
  });

  it('offers a fresh row of figures on shuffle', async () => {
    const user = userEvent.setup();
    renderProfile();

    const before = screen.getAllByText(/^Figur /).map((node) => node.textContent);
    await user.click(screen.getByRole('button', { name: 'Blanda om' }));
    const after = screen.getAllByText(/^Figur /).map((node) => node.textContent);

    expect(after).toHaveLength(6);
    expect(after).not.toEqual(before);
  });

  it('opens with the existing profile and keeps the join date on edit', async () => {
    useGameStore.setState({
      profile: {
        displayName: 'Seth',
        avatarSeed: 'bulle',
        createdAt: '2026-01-01T00:00:00.000Z',
        totalScore: 40,
        bestStreakEver: 3,
      },
    });

    const user = userEvent.setup();
    renderProfile();

    expect(screen.getByText('Din profil')).toBeInTheDocument();
    const field = screen.getByLabelText('Visningsnamn');
    expect(field).toHaveValue('Seth');
    // The seed already in use stays on offer, so editing does not force a change.
    expect(screen.getByText('Figur bulle')).toBeInTheDocument();

    await user.clear(field);
    await user.type(field, 'Astrid');
    await user.click(screen.getByRole('button', { name: 'Spara' }));

    const profile = useGameStore.getState().profile;
    expect(profile?.displayName).toBe('Astrid');
    expect(profile?.avatarSeed).toBe('bulle');
    expect(profile?.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
