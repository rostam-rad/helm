/**
 * Tests for computeCostRollup — the pure function backing the v0.2 cost
 * rollup strip. Bucket boundaries are computed in the local timezone, so
 * fixtures use the test machine's local time via `new Date(year, monthIdx,
 * day, hour, minute)` constructors (which interpret args as local).
 */

import { describe, it, expect } from 'vitest';
import { computeCostRollup } from '../../src/renderer/lib/cost-rollup';
import type { SessionMeta } from '@shared/types';

function session(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    id: overrides.id ?? `sess-${Math.random()}`,
    adapter: 'claude-code',
    cwd: '/x',
    projectLabel: 'x',
    filePath: '/x/x.jsonl',
    gitBranch: null,
    startedAt: new Date(2026, 4, 1).toISOString(),
    lastActivityAt: overrides.lastActivityAt ?? new Date().toISOString(),
    lastUserInputAt: null,
    state: { kind: 'awaiting-user', since: '', freshnessTier: 'fresh' },
    isSidechain: false,
    parentSessionId: null,
    messageCount: 0,
    totalTokens: 0,
    totalCostUsd: overrides.totalCostUsd ?? 0,
    model: null,
    modelClass: overrides.modelClass ?? 'cloud',
    modelProvider: null,
    permissionMode: null,
    entrypoint: null,
    agentVersion: null,
    firstUserMessage: null,
    ...overrides,
  };
}

describe('computeCostRollup', () => {
  it('returns zeroed buckets for empty input', () => {
    const result = computeCostRollup([], new Date(2026, 4, 15, 12, 0));
    expect(result.today).toEqual({ totalCostUsd: 0, sessionCount: 0, cloudCount: 0, localCount: 0 });
    expect(result.week).toEqual({ totalCostUsd: 0, sessionCount: 0, cloudCount: 0, localCount: 0 });
    expect(result.month).toEqual({ totalCostUsd: 0, sessionCount: 0, cloudCount: 0, localCount: 0 });
  });

  it('sums cloud cost only for all-cloud sessions in today', () => {
    const now = new Date(2026, 4, 15, 12, 0); // Fri May 15, noon
    const a = session({ id: 'a', totalCostUsd: 1.50, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 15, 9, 0).toISOString() });
    const b = session({ id: 'b', totalCostUsd: 2.75, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 15, 11, 0).toISOString() });

    const r = computeCostRollup([a, b], now);
    expect(r.today.totalCostUsd).toBeCloseTo(4.25, 2);
    expect(r.today.sessionCount).toBe(2);
    expect(r.today.cloudCount).toBe(2);
    expect(r.today.localCount).toBe(0);
  });

  it('counts all-local sessions but contributes $0 to total', () => {
    const now = new Date(2026, 4, 15, 12, 0);
    const a = session({ id: 'a', totalCostUsd: 999, modelClass: 'local',
      lastActivityAt: new Date(2026, 4, 15, 9, 0).toISOString() });
    const b = session({ id: 'b', totalCostUsd: 999, modelClass: 'local',
      lastActivityAt: new Date(2026, 4, 15, 10, 0).toISOString() });

    const r = computeCostRollup([a, b], now);
    expect(r.today.totalCostUsd).toBe(0);
    expect(r.today.sessionCount).toBe(2);
    expect(r.today.cloudCount).toBe(0);
    expect(r.today.localCount).toBe(2);
  });

  it('handles a mix of cloud and local sessions', () => {
    const now = new Date(2026, 4, 15, 12, 0);
    const cloud = session({ id: 'c', totalCostUsd: 3.10, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 15, 8, 0).toISOString() });
    const local = session({ id: 'l', totalCostUsd: 999, modelClass: 'local',
      lastActivityAt: new Date(2026, 4, 15, 9, 0).toISOString() });
    const unknown = session({ id: 'u', totalCostUsd: 5, modelClass: 'unknown',
      lastActivityAt: new Date(2026, 4, 15, 10, 0).toISOString() });

    const r = computeCostRollup([cloud, local, unknown], now);
    expect(r.today.totalCostUsd).toBeCloseTo(3.10, 2);
    expect(r.today.sessionCount).toBe(3);
    expect(r.today.cloudCount).toBe(1);
    expect(r.today.localCount).toBe(1);
  });

  it('respects the today boundary at local midnight', () => {
    const now = new Date(2026, 4, 15, 0, 1); // May 15 at 00:01 local
    const justBefore = session({ id: 'before', totalCostUsd: 10, modelClass: 'cloud',
      // 23:59 on May 14 — same week and month, but yesterday.
      lastActivityAt: new Date(2026, 4, 14, 23, 59).toISOString() });
    const justAfter = session({ id: 'after', totalCostUsd: 1, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 15, 0, 0, 30).toISOString() });

    const r = computeCostRollup([justBefore, justAfter], now);
    expect(r.today.totalCostUsd).toBeCloseTo(1, 2);
    expect(r.today.sessionCount).toBe(1);
    // Both fall inside this week (May 11 Mon → onward).
    expect(r.week.sessionCount).toBe(2);
    expect(r.month.sessionCount).toBe(2);
  });

  it('treats Sunday as the last day of the previous week (Monday-start)', () => {
    // Sunday May 17 2026, 10:00 local. Last Monday is May 11.
    const sun = new Date(2026, 4, 17, 10, 0);
    const onLastMonday = session({ id: 'mon', totalCostUsd: 1, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 11, 0, 1).toISOString() });
    const onPriorSunday = session({ id: 'prevsun', totalCostUsd: 1, modelClass: 'cloud',
      // Sun May 10 — previous week.
      lastActivityAt: new Date(2026, 4, 10, 23, 59).toISOString() });

    const r = computeCostRollup([onLastMonday, onPriorSunday], sun);
    expect(r.week.sessionCount).toBe(1); // only the May 11 session
    expect(r.month.sessionCount).toBe(2); // both are in May
  });

  it('Monday morning includes itself in the current week', () => {
    const monMorning = new Date(2026, 4, 11, 9, 0); // Mon May 11, 09:00
    const earlyMonday = session({ id: 'm', totalCostUsd: 2, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 11, 0, 5).toISOString() });
    const lastSunday = session({ id: 's', totalCostUsd: 5, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 10, 22, 0).toISOString() });

    const r = computeCostRollup([earlyMonday, lastSunday], monMorning);
    expect(r.week.sessionCount).toBe(1);
    expect(r.week.totalCostUsd).toBeCloseTo(2, 2);
  });

  it('respects the month boundary at the first', () => {
    // June 1 2026, 09:00 local. May 31 sessions are not in the June month bucket.
    const jun1 = new Date(2026, 5, 1, 9, 0);
    const may31 = session({ id: 'may', totalCostUsd: 7, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 31, 23, 30).toISOString() });
    const jun1early = session({ id: 'jun', totalCostUsd: 2, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 5, 1, 8, 0).toISOString() });

    const r = computeCostRollup([may31, jun1early], jun1);
    expect(r.month.sessionCount).toBe(1);
    expect(r.month.totalCostUsd).toBeCloseTo(2, 2);
    // Both fall in the same week (Mon May 25 → Sun May 31 ... but Jun 1 is
    // a Monday, so Jun 1's week starts Jun 1). Just the Jun 1 session.
    expect(r.week.sessionCount).toBe(1);
  });

  it('skips sessions with future lastActivityAt (clock skew defense)', () => {
    const now = new Date(2026, 4, 15, 12, 0);
    const future = session({ id: 'future', totalCostUsd: 100, modelClass: 'cloud',
      lastActivityAt: new Date(2026, 4, 15, 13, 0).toISOString() });
    const r = computeCostRollup([future], now);
    expect(r.today.sessionCount).toBe(0);
    expect(r.today.totalCostUsd).toBe(0);
  });

  it('skips sessions with malformed lastActivityAt', () => {
    const now = new Date(2026, 4, 15, 12, 0);
    const bad = session({ id: 'bad', totalCostUsd: 100, modelClass: 'cloud',
      lastActivityAt: 'not-a-date' });
    const r = computeCostRollup([bad], now);
    expect(r.today.sessionCount).toBe(0);
  });
});
