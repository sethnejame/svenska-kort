import type { LeitnerBox, SessionResult, WordStat } from '../types/progress';
import { MASTERED_BOX } from './progress';

/** Twelve weeks is a season of study, and 7×12 cells still fit 375px. */
export const HEATMAP_WEEKS = 12;
/** Enough sessions to see a trend, few enough that each bar is still tappable. */
export const TREND_SESSIONS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Totals {
  sessions: number;
  answered: number;
  correct: number;
  /** 0–1, and 0 before the first answer rather than NaN. */
  accuracy: number;
}

export function totals(sessions: readonly SessionResult[]): Totals {
  let answered = 0;
  let correct = 0;
  for (const session of sessions) {
    answered += session.answered;
    correct += session.correct;
  }
  return {
    sessions: sessions.length,
    answered,
    correct,
    accuracy: answered === 0 ? 0 : correct / answered,
  };
}

export interface BoxCount {
  box: LeitnerBox;
  count: number;
}

export interface Mastery {
  /** Words with a record at all: everything ever put in front of the learner. */
  started: number;
  mastered: number;
  /** Boxes 1–5, in order, so the caller can render them without re-sorting. */
  byBox: BoxCount[];
}

const BOXES: LeitnerBox[] = [1, 2, 3, 4, 5];

export function mastery(stats: Readonly<Record<string, WordStat>>): Mastery {
  const counts: Record<LeitnerBox, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let started = 0;
  let mastered = 0;

  for (const stat of Object.values(stats)) {
    started += 1;
    if (stat.box >= MASTERED_BOX) mastered += 1;
    counts[stat.box] += 1;
  }

  return {
    started,
    mastered,
    byBox: BOXES.map((box) => ({ box, count: counts[box] })),
  };
}

/**
 * The calendar day an instant fell on *where the learner was*, which is the
 * day they would say they practised. Formatted `YYYY-MM-DD` so it sorts.
 */
export function localDay(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export interface DayCell {
  day: string;
  answered: number;
  /** 0 for a day off, then 1–4 by how much was answered. */
  level: number;
}

function level(answered: number): number {
  if (answered === 0) return 0;
  if (answered < 10) return 1;
  if (answered < 25) return 2;
  if (answered < 50) return 3;
  return 4;
}

/** Monday, because a Swedish week starts there and so does the grid. */
function mondayOf(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay() is 0 on Sunday, which is six days after that week's Monday.
  const back = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - back);
  return monday;
}

/**
 * One cell per day from the Monday that opens the window through `today`, so a
 * seven-column grid lays itself out with no per-cell positioning.
 */
export function heatmap(
  sessions: readonly SessionResult[],
  today: Date,
  weeks = HEATMAP_WEEKS,
): DayCell[] {
  const answeredByDay = new Map<string, number>();
  for (const session of sessions) {
    const day = localDay(new Date(session.endedAt));
    answeredByDay.set(day, (answeredByDay.get(day) ?? 0) + session.answered);
  }

  const last = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const first = mondayOf(new Date(last.getTime() - (weeks - 1) * 7 * DAY_MS));

  const cells: DayCell[] = [];
  // Stepped by date rather than by milliseconds: a daylight-saving change makes
  // one day 23 hours long, and adding 86 400 000 would skip or repeat it.
  for (const cursor = first; cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    const day = localDay(cursor);
    const answered = answeredByDay.get(day) ?? 0;
    cells.push({ day, answered, level: level(answered) });
  }

  return cells;
}

/**
 * Days practised in a row, ending today or yesterday — a streak is not broken
 * until a whole day has gone by without playing.
 */
export function dayStreak(sessions: readonly SessionResult[], today: Date): number {
  const days = new Set<string>();
  for (const session of sessions) days.add(localDay(new Date(session.endedAt)));

  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (!days.has(localDay(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(localDay(cursor))) return 0;
  }

  let streak = 0;
  while (days.has(localDay(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export interface TrendPoint {
  id: string;
  /** 0–1. Only sessions with an answer in them get a point. */
  accuracy: number;
  answered: number;
  endedAt: string;
}

/** The most recent runs, oldest first, so the chart reads left to right. */
export function accuracyTrend(
  sessions: readonly SessionResult[],
  count = TREND_SESSIONS,
): TrendPoint[] {
  const scored = sessions.filter((session) => session.answered > 0);
  return scored.slice(-count).map((session) => ({
    id: session.id,
    accuracy: session.correct / session.answered,
    answered: session.answered,
    endedAt: session.endedAt,
  }));
}
