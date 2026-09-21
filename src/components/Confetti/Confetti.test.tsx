import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { Confetti } from './Confetti';

function dotsIn(container: HTMLElement) {
  return [...container.querySelectorAll('span')];
}

/** jsdom's own `matchMedia` never matches anything, which is the default we want. */
function reduceMotion() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('Confetti', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stays out of the way until a milestone', () => {
    const { container, rerender } = render(<Confetti streak={0} />);
    expect(dotsIn(container)).toHaveLength(0);

    for (const streak of [1, 2, 3, 4]) {
      rerender(<Confetti streak={streak} />);
      expect(dotsIn(container)).toHaveLength(0);
    }
  });

  it('bursts at five, ten and twenty-five', () => {
    const { container, rerender } = render(<Confetti streak={4} />);

    for (const streak of [5, 10, 25]) {
      rerender(<Confetti streak={streak} />);
      expect(dotsIn(container)).toHaveLength(16);
      // Back to a plain streak so the next milestone is a fresh arrival.
      rerender(<Confetti streak={streak + 1} />);
    }
  });

  it('does not fire again while the streak sits on the milestone', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Confetti streak={4} />);

    rerender(<Confetti streak={5} />);
    expect(dotsIn(container)).toHaveLength(16);

    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(dotsIn(container)).toHaveLength(0);

    rerender(<Confetti streak={5} />);
    expect(dotsIn(container)).toHaveLength(0);
  });

  it('clears itself once the animation is over', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Confetti streak={4} />);
    rerender(<Confetti streak={5} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(dotsIn(container)).toHaveLength(16);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelector('div')).toBeNull();
  });

  it('celebrates a rebuilt streak, because that one was earned twice', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Confetti streak={5} />);

    rerender(<Confetti streak={0} />);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(dotsIn(container)).toHaveLength(0);

    rerender(<Confetti streak={5} />);
    expect(dotsIn(container)).toHaveLength(16);
  });

  it('mounts nothing at all under reduced motion', () => {
    reduceMotion();
    const { container, rerender } = render(<Confetti streak={4} />);

    rerender(<Confetti streak={5} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('paints only from the four celebration tokens', () => {
    const { container, rerender } = render(<Confetti streak={4} />);
    rerender(<Confetti streak={5} />);

    const used = new Set(dotsIn(container).map((dot) => dot.style.getPropertyValue('--dot-color')));
    expect([...used].sort()).toEqual([
      'var(--c-accent)',
      'var(--c-correct)',
      'var(--c-primary)',
      'var(--c-swede)',
    ]);
  });

  it('is decoration, so a screen reader never sees it', () => {
    const { container, rerender } = render(<Confetti streak={4} />);
    rerender(<Confetti streak={5} />);

    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});
