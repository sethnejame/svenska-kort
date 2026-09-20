import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WordEntry } from '../../types/word';
import { getEntry } from '../../data/decks';
import { Card } from './Card';

function seed(id: string): WordEntry {
  const entry = getEntry(id);
  if (!entry) throw new Error(`seed entry ${id} is missing`);
  return entry;
}

describe('Card', () => {
  it('renders the Swedish word, marked as Swedish, with a part-of-speech chip', () => {
    render(<Card entry={seed('regering-noun')} flipped={false} />);

    const word = screen.getByText('regeringen', { selector: 'span[lang="sv"]' });
    expect(word).toHaveAttribute('lang', 'sv');
    expect(screen.getByText('substantiv')).toBeInTheDocument();
  });

  it('shows "av <lemma>" only when the lemma differs from the shown form', () => {
    const { unmount } = render(<Card entry={seed('begrava-verb')} flipped={false} />);
    expect(screen.getByText(/^av/)).toHaveTextContent('av begrava');
    unmount();

    render(<Card entry={seed('makt-noun')} flipped={false} />);
    expect(screen.queryByText(/^av/)).not.toBeInTheDocument();
  });

  it('renders the answer, all four noun forms and the gender chip on the back', () => {
    render(<Card entry={seed('regering-noun')} flipped />);

    expect(screen.getByText('the government')).toBeInTheDocument();
    expect(screen.getByText('regeringarna')).toBeInTheDocument();
    expect(screen.getByText('en')).toBeInTheDocument();
  });

  it('renders no forms table and does render the note for a phrase', () => {
    const entry = seed('fast-jag-tycker-phrase');
    expect(entry.forms?.kind).toBe('none');

    render(<Card entry={entry} flipped />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText(/Softens a disagreement/)).toBeInTheDocument();
  });

  it('shows the full paradigm for an inflected verb', () => {
    render(<Card entry={seed('begrava-verb')} flipped />);

    // Scoped to the table: "begrava" also appears in the "av begrava" lemma line.
    const table = within(screen.getByRole('table'));
    for (const form of ['begrava', 'begraver', 'begravde', 'begravt']) {
      expect(table.getByText(form)).toBeInTheDocument();
    }
  });

  it('steps the font size down as the word gets longer', () => {
    const sizeOf = (swedish: string): string => {
      const { container, unmount } = render(
        <Card entry={{ id: 'x', swedish, english: ['x'], pos: 'other' }} flipped={false} />,
      );
      const node = container.querySelector('[lang="sv"]');
      const className = node?.className ?? '';
      unmount();
      return className;
    };

    expect(sizeOf('makt')).toMatch(/sizeFull/);
    expect(sizeOf('städbranschen')).toMatch(/sizeMedium/);
    expect(sizeOf('att man kan ett språk')).toMatch(/sizeTiny/);
  });

  it('is a button that reports and toggles flip state when onFlip is given', async () => {
    const onFlip = vi.fn();
    const user = userEvent.setup();
    render(<Card entry={seed('regering-noun')} flipped={false} onFlip={onFlip} />);

    const card = screen.getByRole('button', { name: /regeringen/ });
    expect(card).toHaveAttribute('aria-pressed', 'false');

    await user.click(card);
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('flips from the keyboard with Space', async () => {
    const onFlip = vi.fn();
    const user = userEvent.setup();
    render(<Card entry={seed('regering-noun')} flipped={false} onFlip={onFlip} />);

    await user.tab();
    expect(screen.getByRole('button', { name: /regeringen/ })).toHaveFocus();

    await user.keyboard(' ');
    expect(onFlip).toHaveBeenCalledTimes(1);
  });

  it('reflects flipped state through aria-pressed', () => {
    render(<Card entry={seed('regering-noun')} flipped onFlip={vi.fn()} />);
    expect(screen.getByRole('button', { name: /regeringen/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('is not a button when it cannot be flipped', () => {
    render(<Card entry={seed('regering-noun')} flipped={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
