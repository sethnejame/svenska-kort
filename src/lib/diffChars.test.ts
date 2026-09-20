import { describe, expect, it } from 'vitest';
import { diffChars } from './diffChars';

const marked = (segments: { text: string; marked: boolean }[]): string =>
  segments
    .filter((s) => s.marked)
    .map((s) => s.text)
    .join('');

const text = (segments: { text: string }[]): string => segments.map((s) => s.text).join('');

describe('diffChars', () => {
  it('marks only the missing character for decresed vs decreased', () => {
    const diff = diffChars('decresed', 'decreased');

    expect(marked(diff.typed)).toBe('');
    expect(marked(diff.answer)).toBe('a');
    expect(text(diff.typed)).toBe('decresed');
    expect(text(diff.answer)).toBe('decreased');
  });

  it('marks the substituted characters on both sides', () => {
    const diff = diffChars('hus', 'has');

    expect(marked(diff.typed)).toBe('u');
    expect(marked(diff.answer)).toBe('a');
  });

  it('marks nothing when the strings are identical', () => {
    const diff = diffChars('makt', 'makt');

    expect(diff.typed).toEqual([{ text: 'makt', marked: false }]);
    expect(diff.answer).toEqual([{ text: 'makt', marked: false }]);
  });

  it('marks a trailing extra character on the longer side', () => {
    const diff = diffChars('powers', 'power');

    expect(marked(diff.typed)).toBe('s');
    expect(marked(diff.answer)).toBe('');
  });

  it('marks a trailing missing character on the answer side', () => {
    const diff = diffChars('power', 'powers');

    expect(marked(diff.typed)).toBe('');
    expect(marked(diff.answer)).toBe('s');
  });

  it('marks a leading difference without eating the shared tail', () => {
    const diff = diffChars('bury', 'hurry');

    expect(text(diff.typed)).toBe('bury');
    expect(text(diff.answer)).toBe('hurry');
    expect(diff.typed[0]).toEqual({ text: 'bu', marked: true });
    expect(diff.answer[0]).toEqual({ text: 'hur', marked: true });
  });

  it('marks the whole of both sides when nothing is shared', () => {
    const diff = diffChars('abc', 'xyz');

    expect(marked(diff.typed)).toBe('abc');
    expect(marked(diff.answer)).toBe('xyz');
  });

  it('handles an empty typed string', () => {
    const diff = diffChars('', 'makt');

    expect(diff.typed).toEqual([]);
    expect(diff.answer).toEqual([{ text: 'makt', marked: true }]);
  });

  it('counts graphemes, not UTF-16 units', () => {
    const diff = diffChars('språk', 'sprak');

    expect(marked(diff.typed)).toBe('å');
    expect(marked(diff.answer)).toBe('a');
  });
});
