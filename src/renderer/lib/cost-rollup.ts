/**
 * Cost rollup buckets for the multi-session view header strip.
 *
 * Pure function over SessionMeta[]. No I/O, no Date.now() — caller
 * supplies `now` so the function is fully deterministic and testable
 * across timezones and bucket boundaries.
 *
 * Bucket boundaries are computed in the *user's local timezone*:
 *  - today  : local midnight today → end of today
 *  - week   : last Monday at local midnight → end of today
 *  - month  : first of current month at local midnight → end of today
 *
 * A session is "in" a bucket if `lastActivityAt` falls within the
 * bucket's [start, now] range. Cost is summed only across cloud
 * sessions (local agents are free by definition — modelClass === 'local'
 * contributes to the count but not the cost total).
 */

import type { SessionMeta } from '@shared/types';

export interface Bucket {
  totalCostUsd: number;
  sessionCount: number;
  cloudCount: number;
  localCount: number;
}

export interface CostRollup {
  today: Bucket;
  week: Bucket;
  month: Bucket;
}

/** Local midnight at the start of the day containing `d`. */
function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Local midnight at the start of the most recent Monday on or before `d`.
 *  JS getDay(): Sunday=0, Monday=1, ..., Saturday=6. We treat Monday as
 *  the week start (ISO 8601 convention) — Sunday rolls back six days. */
function startOfLocalWeek(d: Date): Date {
  const day = d.getDay();
  const daysSinceMonday = (day + 6) % 7; // Mon→0, Tue→1, ..., Sun→6
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday, 0, 0, 0, 0);
  return monday;
}

/** Local midnight on the first of the month containing `d`. */
function startOfLocalMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

function emptyBucket(): Bucket {
  return { totalCostUsd: 0, sessionCount: 0, cloudCount: 0, localCount: 0 };
}

function addToBucket(b: Bucket, session: SessionMeta): void {
  b.sessionCount++;
  if (session.modelClass === 'cloud') {
    b.cloudCount++;
    b.totalCostUsd += session.totalCostUsd;
  } else if (session.modelClass === 'local') {
    b.localCount++;
    // Local sessions are free — totalCostUsd is left as the cloud-only sum.
  }
  // modelClass === 'unknown' counts toward sessionCount only; we don't
  // attribute its cost or class because it's ambiguous by definition.
}

export function computeCostRollup(sessions: SessionMeta[], now: Date): CostRollup {
  const todayStart = startOfLocalDay(now).getTime();
  const weekStart = startOfLocalWeek(now).getTime();
  const monthStart = startOfLocalMonth(now).getTime();
  const nowMs = now.getTime();

  const today = emptyBucket();
  const week = emptyBucket();
  const month = emptyBucket();

  for (const s of sessions) {
    const lastMs = Date.parse(s.lastActivityAt);
    if (!Number.isFinite(lastMs) || lastMs > nowMs) continue;

    if (lastMs >= monthStart) addToBucket(month, s);
    if (lastMs >= weekStart)  addToBucket(week, s);
    if (lastMs >= todayStart) addToBucket(today, s);
  }

  return { today, week, month };
}
