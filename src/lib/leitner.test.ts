import { describe, expect, it } from 'vitest';
import { nextBox } from './leitner';

describe('nextBox', () => {
  it('promotes one box on correct and caps at five', () => {
    expect(nextBox(1, 'correct')).toBe(2);
    expect(nextBox(4, 'correct')).toBe(5);
    expect(nextBox(5, 'correct')).toBe(5);
  });

  it('holds on close', () => {
    expect(nextBox(3, 'close')).toBe(3);
  });

  it('drops to box one on wrong', () => {
    expect(nextBox(5, 'wrong')).toBe(1);
    expect(nextBox(1, 'wrong')).toBe(1);
  });
});
