/**
 * The only file in the repo that touches `localStorage`.
 *
 * Private mode, blocked site data and quota exhaustion all throw from the
 * storage API rather than returning an error, so every call is guarded and
 * falls back to an in-memory map. The app then works for the session and
 * simply forgets on reload, which is far better than a white screen.
 */

const memory = new Map<string, string>();
let memoryOnly = false;

function backing(): Storage | null {
  if (memoryOnly) return null;
  try {
    const probe = '__svenska-kort probe__';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    memoryOnly = true;
    return null;
  }
}

export function getItem(key: string): string | null {
  const store = backing();
  if (!store) return memory.get(key) ?? null;
  try {
    return store.getItem(key);
  } catch {
    memoryOnly = true;
    return memory.get(key) ?? null;
  }
}

export function setItem(key: string, value: string): void {
  memory.set(key, value);
  const store = backing();
  if (!store) return;
  try {
    store.setItem(key, value);
  } catch {
    // Quota or a mid-session permission change. The memory copy already holds it.
    memoryOnly = true;
  }
}

export function removeItem(key: string): void {
  memory.delete(key);
  const store = backing();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    memoryOnly = true;
  }
}

/** True when persistence has degraded to memory and will not survive a reload. */
export function isMemoryOnly(): boolean {
  return memoryOnly;
}

/** Test seam: forgets the memory fallback and re-probes real storage. */
export function resetStorageForTests(): void {
  memory.clear();
  memoryOnly = false;
}
