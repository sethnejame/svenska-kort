import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProgressRing } from './ProgressRing';

function offset(container: HTMLElement): number {
  const circles = container.querySelectorAll('circle');
  return Number(circles[1]?.getAttribute('stroke-dashoffset'));
}

describe('ProgressRing', () => {
  it('shows the mastered count and spells the ratio out for a screen reader', () => {
    render(<ProgressRing mastered={7} total={20} />);

    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('7 av 20 kan du')).toBeInTheDocument();
  });

  it('empties the ring at zero and fills it at full', () => {
    const { container: none } = render(<ProgressRing mastered={0} total={10} />);
    const { container: all } = render(<ProgressRing mastered={10} total={10} />);

    expect(offset(none)).toBeGreaterThan(0);
    expect(offset(all)).toBe(0);
  });

  it('draws an empty ring for an empty deck rather than NaN', () => {
    const { container } = render(<ProgressRing mastered={0} total={0} />);
    expect(offset(container)).toBeGreaterThan(0);
  });
});
