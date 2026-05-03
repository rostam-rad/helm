/**
 * Tests for the pure selector functions exported from useSessionsStore:
 *   listSessions  — sort by lastActivityAt descending
 *   applyFilter   — filter chips + search query
 *   summarise     — aggregate counts / totals
 *
 * After the SessionState migration: "active" means anything that isn't a
 * stale awaiting-user. The 'blocked' filter replaces the old 'errors' filter
 * since SessionMeta now exposes a real blocked state via SessionState.
 */

import { describe, it, expect } from 'vitest';
import { listSessions, applyFilter, summarise } from '../../src/renderer/stores/useSessionsStore';
import type { SessionMeta, SessionState } from '../../src/shared/types';

const STALE_AWAITING: SessionState = { kind: 'awaiting-user', since: '2026-05-01T00:00:00.000Z', freshnessTier: 'stale' };
const FRESH_AWAITING: SessionState = { kind: 'awaiting-user', since: '2026-05-02T11:59:00.000Z', freshnessTier: 'fresh' };
const WORKING: SessionState = { kind: 'working', since: '2026-05-02T11:59:59.500Z' };
const BLOCKED_QUESTION: SessionState = { kind: 'blocked', since: '2026-05-02T11:59:00.000Z', reason: { type: 'question', toolUseId: 'q1' } };

function makeMeta(overrides: Partial<SessionMeta> & { id: string }): SessionMeta {
  return {
    adapter: 'claude-code',
    cwd: '/tmp/project',
    projectLabel: overrides.id,
    filePath: `/tmp/${overrides.id}.jsonl`,
    gitBranch: 'main',
    startedAt: '2026-05-02T10:00:00.000Z',
    lastActivityAt: '2026-05-02T10:00:00.000Z',
    state: STALE_AWAITING,
    isSidechain: false,
    parentSessionId: null,
    messageCount: 5,
    totalTokens: 1000,
    totalCostUsd: 0.01,
    model: 'claude-sonnet-4-6',
    modelClass: 'cloud',
    modelProvider: 'anthropic',
    permissionMode: 'default',
    entrypoint: null,
    agentVersion: '2.1.0',
    firstUserMessage: 'Test message',
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// listSessions
// ──────────────────────────────────────────────────────────────────────────────

describe('listSessions', () => {
  it('returns an empty array for an empty record', () => {
    expect(listSessions({})).toEqual([]);
  });

  it('returns a single session as a one-element array', () => {
    const s = makeMeta({ id: 'a' });
    const result = listSessions({ a: s });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('a');
  });

  it('sorts sessions newest lastActivityAt first', () => {
    const old  = makeMeta({ id: 'old',  lastActivityAt: '2026-05-01T10:00:00.000Z' });
    const mid  = makeMeta({ id: 'mid',  lastActivityAt: '2026-05-02T08:00:00.000Z' });
    const newS = makeMeta({ id: 'new',  lastActivityAt: '2026-05-02T12:00:00.000Z' });
    const result = listSessions({ old, mid, new: newS });
    expect(result.map(s => s.id)).toEqual(['new', 'mid', 'old']);
  });

  it('is stable when timestamps are equal', () => {
    const a = makeMeta({ id: 'a', lastActivityAt: '2026-05-02T10:00:00.000Z' });
    const b = makeMeta({ id: 'b', lastActivityAt: '2026-05-02T10:00:00.000Z' });
    const result = listSessions({ a, b });
    expect(result).toHaveLength(2);
  });

  it('does not mutate the input record', () => {
    const s = makeMeta({ id: 'a' });
    const record = { a: s };
    const result = listSessions(record);
    expect(result).not.toBe(record);
    expect(record.a).toBe(s);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// applyFilter
// ──────────────────────────────────────────────────────────────────────────────

describe('applyFilter — all', () => {
  it('returns all sessions when filter is all and query is empty', () => {
    const sessions = [
      makeMeta({ id: 'a', state: WORKING }),
      makeMeta({ id: 'b', state: STALE_AWAITING }),
    ];
    expect(applyFilter(sessions, 'all', '')).toHaveLength(2);
  });
});

describe('applyFilter — active', () => {
  it('returns sessions whose state is not stale awaiting-user', () => {
    const sessions = [
      makeMeta({ id: 'a', state: WORKING }),
      makeMeta({ id: 'b', state: STALE_AWAITING }),
      makeMeta({ id: 'c', state: BLOCKED_QUESTION }),
      makeMeta({ id: 'd', state: FRESH_AWAITING }),
    ];
    const result = applyFilter(sessions, 'active', '');
    expect(result.map(s => s.id)).toEqual(['a', 'c', 'd']);
  });

  it('returns empty when all sessions are stale awaiting-user', () => {
    const sessions = [makeMeta({ id: 'a', state: STALE_AWAITING })];
    expect(applyFilter(sessions, 'active', '')).toHaveLength(0);
  });
});

describe('applyFilter — cloud', () => {
  it('returns only cloud sessions', () => {
    const sessions = [
      makeMeta({ id: 'cloud1', modelClass: 'cloud' }),
      makeMeta({ id: 'local1', modelClass: 'local' }),
      makeMeta({ id: 'unk',    modelClass: 'unknown' }),
    ];
    const result = applyFilter(sessions, 'cloud', '');
    expect(result.map(s => s.id)).toEqual(['cloud1']);
  });
});

describe('applyFilter — local', () => {
  it('returns only local sessions', () => {
    const sessions = [
      makeMeta({ id: 'cloud1', modelClass: 'cloud' }),
      makeMeta({ id: 'local1', modelClass: 'local' }),
    ];
    const result = applyFilter(sessions, 'local', '');
    expect(result.map(s => s.id)).toEqual(['local1']);
  });
});

describe('applyFilter — blocked', () => {
  it('returns only sessions whose state.kind is blocked', () => {
    const sessions = [
      makeMeta({ id: 'a', state: WORKING }),
      makeMeta({ id: 'b', state: BLOCKED_QUESTION }),
      makeMeta({ id: 'c', state: FRESH_AWAITING }),
    ];
    const result = applyFilter(sessions, 'blocked', '');
    expect(result.map(s => s.id)).toEqual(['b']);
  });

  it('returns empty when no blocked sessions exist', () => {
    const sessions = [makeMeta({ id: 'a', state: WORKING })];
    expect(applyFilter(sessions, 'blocked', '')).toHaveLength(0);
  });
});

describe('applyFilter — search query', () => {
  const sessions = [
    makeMeta({ id: 's1', projectLabel: 'AudioSnap',      model: 'claude-opus-4-7',    gitBranch: 'feature/audio',  cwd: '/Users/dev/audiosnap' }),
    makeMeta({ id: 's2', projectLabel: 'HiroLabs',       model: 'gpt-4o',             gitBranch: 'main',           cwd: '/Users/dev/hirolabs' }),
    makeMeta({ id: 's3', projectLabel: 'my-site',        model: null,                 gitBranch: null,             cwd: '/var/www/my-site' }),
  ];

  it('matches on projectLabel (case-insensitive)', () => {
    expect(applyFilter(sessions, 'all', 'audiosnap').map(s => s.id)).toEqual(['s1']);
  });

  it('matches on model name', () => {
    expect(applyFilter(sessions, 'all', 'gpt-4o').map(s => s.id)).toEqual(['s2']);
  });

  it('matches on gitBranch', () => {
    expect(applyFilter(sessions, 'all', 'feature/audio').map(s => s.id)).toEqual(['s1']);
  });

  it('matches on cwd path', () => {
    expect(applyFilter(sessions, 'all', '/var/www').map(s => s.id)).toEqual(['s3']);
  });

  it('is case-insensitive', () => {
    expect(applyFilter(sessions, 'all', 'HIROLABS').map(s => s.id)).toEqual(['s2']);
  });

  it('returns all when query is only whitespace', () => {
    expect(applyFilter(sessions, 'all', '   ')).toHaveLength(3);
  });

  it('returns empty when query matches nothing', () => {
    expect(applyFilter(sessions, 'all', 'zzz-no-match')).toHaveLength(0);
  });

  it('handles null model gracefully', () => {
    expect(applyFilter(sessions, 'all', 'my-site').map(s => s.id)).toEqual(['s3']);
  });

  it('combines filter and query — active AND matching label', () => {
    const mixed = [
      makeMeta({ id: 'a', projectLabel: 'AudioSnap', state: WORKING        }),
      makeMeta({ id: 'b', projectLabel: 'AudioSnap', state: STALE_AWAITING }),
      makeMeta({ id: 'c', projectLabel: 'Other',     state: WORKING        }),
    ];
    expect(applyFilter(mixed, 'active', 'AudioSnap').map(s => s.id)).toEqual(['a']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// summarise
// ──────────────────────────────────────────────────────────────────────────────

describe('summarise', () => {
  it('returns all-zero summary for empty array', () => {
    const s = summarise([]);
    expect(s).toEqual({
      total: 0, active: 0, cloud: 0, local: 0, free: 0,
      totalCost: 0, totalTokens: 0, byAdapter: {},
    });
  });

  it('counts total correctly', () => {
    const sessions = [makeMeta({ id: 'a' }), makeMeta({ id: 'b' })];
    expect(summarise(sessions).total).toBe(2);
  });

  it('counts active sessions (anything that is not stale awaiting-user)', () => {
    const sessions = [
      makeMeta({ id: 'a', state: WORKING }),
      makeMeta({ id: 'b', state: STALE_AWAITING }),
      makeMeta({ id: 'c', state: FRESH_AWAITING }),
    ];
    expect(summarise(sessions).active).toBe(2);
  });

  it('counts cloud and local sessions', () => {
    const sessions = [
      makeMeta({ id: 'a', modelClass: 'cloud' }),
      makeMeta({ id: 'b', modelClass: 'cloud' }),
      makeMeta({ id: 'c', modelClass: 'local' }),
      makeMeta({ id: 'd', modelClass: 'unknown' }),
    ];
    const s = summarise(sessions);
    expect(s.cloud).toBe(2);
    expect(s.local).toBe(1);
  });

  it('counts free (zero cost) sessions', () => {
    const sessions = [
      makeMeta({ id: 'a', totalCostUsd: 0 }),
      makeMeta({ id: 'b', totalCostUsd: 0.05 }),
      makeMeta({ id: 'c', totalCostUsd: -0.01 }),
    ];
    expect(summarise(sessions).free).toBe(2);
  });

  it('sums totalCost and totalTokens', () => {
    const sessions = [
      makeMeta({ id: 'a', totalCostUsd: 0.10, totalTokens: 1000 }),
      makeMeta({ id: 'b', totalCostUsd: 0.25, totalTokens: 2500 }),
    ];
    const s = summarise(sessions);
    expect(s.totalCost).toBeCloseTo(0.35);
    expect(s.totalTokens).toBe(3500);
  });

  it('counts sessions by adapter', () => {
    const sessions = [
      makeMeta({ id: 'a', adapter: 'claude-code' }),
      makeMeta({ id: 'b', adapter: 'claude-code' }),
      makeMeta({ id: 'c', adapter: 'codex' }),
    ];
    const s = summarise(sessions);
    expect(s.byAdapter['claude-code']).toBe(2);
    expect(s.byAdapter['codex']).toBe(1);
  });
});
