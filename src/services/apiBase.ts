/**
 * Where the API lives. Read once, here, so no other file touches `import.meta.env`.
 *
 * This is a public URL, not a secret — the repo is public and this value is
 * bundled. Nothing that must stay private is ever read from the environment on
 * this side of the wire.
 */
const configured: unknown = import.meta.env.VITE_API_BASE;

/** Empty when unset, which is the v1 state: the app is fully local and offline-first. */
export const API_BASE: string =
  typeof configured === 'string' ? configured.replace(/\/+$/, '') : '';

export function hasApi(): boolean {
  return API_BASE.length > 0;
}

/** `apiUrl('/api/health')` — leading slash required, so a typo is a type error's job. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
