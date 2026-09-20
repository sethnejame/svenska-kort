import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './Avatar';

function markup(seed: string): string {
  const { container } = render(<Avatar seed={seed} />);
  return container.innerHTML;
}

describe('Avatar', () => {
  it('draws the identical picture for the identical seed', () => {
    expect(markup('kanelbulle')).toBe(markup('kanelbulle'));
  });

  it('draws different pictures for different seeds', () => {
    expect(markup('kanelbulle')).not.toBe(markup('lingonsylt'));
  });

  it('covers every shape, eye and mouth variant without throwing', () => {
    const drawn = new Set<string>();
    for (let index = 0; index < 64; index += 1) drawn.add(markup(`seed-${index}`));
    expect(drawn.size).toBeGreaterThan(8);
  });

  it('is decorative by default and labelled when asked', () => {
    const { container } = render(<Avatar seed="a" />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');

    const { getByRole } = render(<Avatar seed="a" label="Din avatar" />);
    expect(getByRole('img', { name: 'Din avatar' })).toBeInTheDocument();
  });

  it('scales to the size it is given', () => {
    const { container } = render(<Avatar seed="a" size={96} />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '96');
  });
});
