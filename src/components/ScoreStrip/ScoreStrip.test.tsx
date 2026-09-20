import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreStrip } from './ScoreStrip';

const base = { deckName: 'Alla ord', streak: 0, sessionScore: 0, bestStreakEver: 0 };

describe('ScoreStrip', () => {
  it('shows the deck name, streak, session score and best-ever streak', () => {
    render(
      <ScoreStrip
        {...base}
        deckName="Skola och språk"
        streak={3}
        sessionScore={120}
        bestStreakEver={11}
      />,
    );

    expect(screen.getByText('Skola och språk')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('120 p')).toBeInTheDocument();
    expect(screen.getByText(/Bästa svit: 11/)).toBeInTheDocument();
  });

  it('announces the score but not the streak, so the two do not fight', () => {
    const { container } = render(<ScoreStrip {...base} streak={2} sessionScore={40} />);

    const live = container.querySelectorAll('[aria-live]');
    expect(live).toHaveLength(1);
    expect(live[0]).toHaveTextContent('40 p');
  });

  it('truncates a long deck name rather than wrapping', () => {
    render(<ScoreStrip {...base} deckName="Ett mycket långt deck-namn som inte får radbrytas" />);

    const name = screen.getByText(/Ett mycket långt/);
    expect(name.className).toMatch(/deckName/);
  });

  it('grows the flame with the streak and then caps it', () => {
    const sizeAt = (streak: number): string | null => {
      const { container, unmount } = render(<ScoreStrip {...base} streak={streak} />);
      const width = container.querySelector('svg')?.getAttribute('width') ?? null;
      unmount();
      return width;
    };

    expect(sizeAt(0)).toBe('16');
    expect(sizeAt(4)).toBe('20');
    expect(sizeAt(99)).toBe('28');
  });

  it('bumps the streak number when it increments, not when it resets', () => {
    const { rerender } = render(<ScoreStrip {...base} streak={1} />);
    expect(screen.getByText('1').className).not.toMatch(/bump/);

    rerender(<ScoreStrip {...base} streak={2} />);
    expect(screen.getByText('2').className).toMatch(/bump/);

    rerender(<ScoreStrip {...base} streak={0} />);
    expect(screen.getByText('0').className).not.toMatch(/bump/);
  });
});
