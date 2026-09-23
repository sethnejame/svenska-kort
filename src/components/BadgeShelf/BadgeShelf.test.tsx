import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BADGE_IDS, BADGE_META } from '../../../shared/badges';
import { BadgeShelf } from './BadgeShelf';

const badges = vi.hoisted(() => vi.fn());
vi.mock('../../services/scoreStore', () => ({ scoreStore: { badges } }));

describe('BadgeShelf', () => {
  it('renders all nine badges locked when nothing has been earned yet', async () => {
    badges.mockResolvedValue([]);

    render(<BadgeShelf />);

    expect(await screen.findByText(BADGE_META['first-session'].condition)).toBeInTheDocument();
    for (const id of BADGE_IDS) {
      expect(screen.getByText(BADGE_META[id].condition)).toBeInTheDocument();
      expect(screen.queryByText(BADGE_META[id].name)).not.toBeInTheDocument();
      // The name still reaches a screen reader via the button's own label,
      // even though the tile's visible caption is the generic "Låst".
      expect(screen.getByRole('button', { name: `${BADGE_META[id].name} (låst)` })).toBeInTheDocument();
    }
    expect(screen.getAllByText('Låst')).toHaveLength(BADGE_IDS.length);
  });

  it('shows the name of an earned badge instead of its condition', async () => {
    badges.mockResolvedValue(['first-session']);

    render(<BadgeShelf />);

    expect(await screen.findByText('Första steget')).toBeInTheDocument();
    expect(screen.queryByText(BADGE_META['first-session'].condition)).not.toBeInTheDocument();
    // Everything else stays locked.
    expect(screen.getByText(BADGE_META['streak-10'].condition)).toBeInTheDocument();
  });

  it('renders every badge as earned when all nine have been unlocked', async () => {
    badges.mockResolvedValue([...BADGE_IDS]);

    render(<BadgeShelf />);

    for (const id of BADGE_IDS) {
      expect(await screen.findByText(BADGE_META[id].name)).toBeInTheDocument();
    }
    expect(screen.queryByText(BADGE_META['top-ten'].condition)).not.toBeInTheDocument();
  });

  it('leaves every badge locked when the read fails, rather than throwing', async () => {
    badges.mockRejectedValue(new Error('network down'));

    render(<BadgeShelf />);

    expect(await screen.findByText(BADGE_META['first-session'].condition)).toBeInTheDocument();
  });

  it('does not update state after unmounting while the read is still in flight', async () => {
    let resolve!: (ids: string[]) => void;
    badges.mockReturnValue(
      new Promise<string[]>((res) => {
        resolve = res;
      }),
    );

    const { unmount } = render(<BadgeShelf />);
    unmount();

    // Resolving after unmount must not warn about a state update on an
    // unmounted component; nothing left to assert beyond "this does not throw".
    await act(async () => {
      resolve(['first-session']);
      await Promise.resolve();
    });
  });

  it("expands and collapses a badge tile's explanation when tapped", async () => {
    badges.mockResolvedValue([]);
    const user = userEvent.setup();

    render(<BadgeShelf />);
    const tile = await screen.findByRole('button', { name: `${BADGE_META['first-session'].name} (låst)` });

    expect(tile).toHaveAttribute('aria-expanded', 'false');

    await user.click(tile);
    expect(tile).toHaveAttribute('aria-expanded', 'true');

    await user.click(tile);
    expect(tile).toHaveAttribute('aria-expanded', 'false');
  });

  it("names an earned badge's condition with celebratory framing", async () => {
    badges.mockResolvedValue(['first-session']);

    render(<BadgeShelf />);

    expect(
      await screen.findByText(`Upplåst: ${BADGE_META['first-session'].condition}`),
    ).toBeInTheDocument();
  });
});
