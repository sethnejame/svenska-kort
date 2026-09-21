import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { INITIAL_GAME_STATE, useGameStore } from '../../store/useGameStore';
import { RecoveryBanner } from './RecoveryBanner';

describe('RecoveryBanner', () => {
  beforeEach(() => {
    useGameStore.setState({ ...INITIAL_GAME_STATE });
  });

  it('stays hidden when the stored data read back cleanly', () => {
    const { container } = render(<RecoveryBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains what happened when the data could not be read', () => {
    useGameStore.setState({ storageRecovered: true });
    render(<RecoveryBanner />);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Vi kunde inte läsa din tidigare data och började om.',
    );
  });

  it('goes away for good once it is acknowledged', async () => {
    const user = userEvent.setup();
    useGameStore.setState({ storageRecovered: true });
    render(<RecoveryBanner />);

    await user.click(screen.getByRole('button', { name: 'Okej' }));

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // Persisted, so the flag itself has to clear or it comes back on reload.
    expect(useGameStore.getState().storageRecovered).toBe(false);
  });
});
