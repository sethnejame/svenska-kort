import '@testing-library/jest-dom/vitest';

/**
 * jsdom has no `matchMedia` at all, so anything that asks about reduced motion
 * would throw rather than get an answer. The stub answers "no" to every query,
 * which is the browser default; a test that needs a different answer overrides
 * this one.
 */
window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;
