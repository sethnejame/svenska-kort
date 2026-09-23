/**
 * The offline outbox for session submissions.
 *
 * Phase 2 shipped a PWA, so a session finished with no network is a real
 * scenario. `submitSession` never awaits the network for its own success —
 * it writes here and returns. This file is the queue plus the one rule that
 * decides whether a failed send is retried or dropped; `RemoteScoreStore`
 * owns *when* a drain runs, this owns *what happens* during one.
 *
 * Persisted through `store/storage.ts`, same as every other durable value in
 * the app — this is not a component, so it is allowed to.
 */
import { z } from 'zod';
import { submitSessionSchema, type SubmitSessionRequest, type SubmitSessionResponse } from '../../shared/api';
import type { BadgeId } from '../../shared/badges';
import { getItem, setItem } from '../store/storage';
import type { ApiResult } from './apiClient';

const OUTBOX_KEY = 'svenska-kort:outbox:v1';

/** A long offline stretch must not fill storage; the newest sessions matter most. */
export const OUTBOX_MAX = 200;

/** 1s, 4s, 15s, 60s, then every 5 minutes, capped. */
const BACKOFF_MS = [1_000, 4_000, 15_000, 60_000];
const BACKOFF_STEADY_MS = 5 * 60_000;

export function backoffFor(attempts: number): number {
  return BACKOFF_MS[attempts] ?? BACKOFF_STEADY_MS;
}

export interface OutboxEntry {
  payload: SubmitSessionRequest;
  /** Failed retryable sends so far. Zero means never yet attempted. */
  attempts: number;
  nextAttemptAt: number;
}

const entrySchema = z.object({
  payload: submitSessionSchema,
  attempts: z.number().int().nonnegative(),
  nextAttemptAt: z.number(),
});

const outboxSchema = z.object({ entries: z.array(entrySchema) });

function load(): OutboxEntry[] {
  const raw = getItem(OUTBOX_KEY);
  if (raw === null) return [];
  try {
    const parsed = outboxSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data.entries : [];
  } catch {
    return [];
  }
}

function save(entries: readonly OutboxEntry[]): void {
  setItem(OUTBOX_KEY, JSON.stringify({ entries }));
}

export function size(): number {
  return load().length;
}

/** Queues a session for eventual remote submission. Oldest dropped past the cap. */
export function enqueue(payload: SubmitSessionRequest, now: number): void {
  const entries = [...load(), { payload, attempts: 0, nextAttemptAt: now }];
  const trimmed = entries.length > OUTBOX_MAX ? entries.slice(entries.length - OUTBOX_MAX) : entries;
  save(trimmed);
}

/** The earliest a queued entry is due, or null when the queue is empty. */
export function nextDrainAt(): number | null {
  const entries = load();
  if (entries.length === 0) return null;
  return Math.min(...entries.map((entry) => entry.nextAttemptAt));
}

export type Sender = (payload: SubmitSessionRequest) => Promise<ApiResult<SubmitSessionResponse>>;

/**
 * One pass over the queue. Every due entry is sent in turn — sequentially,
 * so a slow network never fires 200 requests at once.
 *
 * A 2xx (success, or the 200 a duplicate replays as — the Worker never
 * returns 409, see `worker/src/session.ts`) drops the entry. A 4xx drops it
 * too: the payload is permanently malformed and retrying cannot fix it. A
 * network error or a 5xx keeps it and backs off.
 *
 * `onBadges`, when given, is called once per successful send whose response
 * names newly-awarded badges. Optional so this file stays a pure queue —
 * decoupled from `useGameStore` and independently testable — with the store
 * wiring supplied by the caller that already sits at that layer.
 */
export async function drain(
  send: Sender,
  now: number,
  onBadges?: (ids: BadgeId[]) => void,
): Promise<void> {
  const entries = load();
  if (entries.length === 0) return;

  const remaining: OutboxEntry[] = [];
  for (const entry of entries) {
    if (entry.nextAttemptAt > now) {
      remaining.push(entry);
      continue;
    }

    const result = await send(entry.payload);
    if (result.ok) {
      if (result.data.badges.length > 0) onBadges?.(result.data.badges);
      continue;
    }
    if (result.status !== null && result.status < 500) continue;

    const attempts = entry.attempts + 1;
    remaining.push({ ...entry, attempts, nextAttemptAt: now + backoffFor(attempts) });
  }

  save(remaining);
}
