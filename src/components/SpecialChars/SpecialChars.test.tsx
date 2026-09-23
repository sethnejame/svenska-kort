import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { SpecialChars } from './SpecialChars';

function stubClipboard(clipboard: Partial<Clipboard> | undefined) {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  });
}

describe('SpecialChars', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders every lower and upper case special character', () => {
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    render(<SpecialChars />);

    for (const char of ['å', 'ä', 'ö', 'Å', 'Ä', 'Ö']) {
      expect(screen.getByRole('button', { name: `Kopiera ${char}` })).toBeInTheDocument();
    }
  });

  it('copies the character tapped and confirms it, then reverts', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    render(<SpecialChars />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kopiera ö' }));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('ö');
    expect(screen.getByText('Kopierat!')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(screen.queryByText('Kopierat!')).not.toBeInTheDocument();
  });

  it('renders nothing when the browser has no Clipboard API', () => {
    stubClipboard(undefined);
    const { container } = render(<SpecialChars />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays quiet when the API exists but permission is denied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('Write permission denied.'));
    stubClipboard({ writeText });
    render(<SpecialChars />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Kopiera ö' }));
      await Promise.resolve();
    });
    expect(screen.queryByText('Kopierat!')).not.toBeInTheDocument();
  });
});
