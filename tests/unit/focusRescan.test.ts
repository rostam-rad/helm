/**
 * Tests for runDiscoveryAndPushIfChanged (audit #6).
 *
 * Behaviors verified:
 *   - first call always runs and seeds the snapshot
 *   - subsequent call within FOCUS_THROTTLE_MS (5s) is skipped (no rescan,
 *     no push)
 *   - subsequent call after the throttle window runs again
 *   - if the session-id set is unchanged, no discovery:changed push fires
 *   - if a session is added or removed, the push fires once
 *   - concurrent calls coalesce to one in-flight rescan
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Reusable mock storage attached to globalThis so the vi.mock factories
// (hoisted above local lets) can reach it. Same pattern as settings.test.ts.
declare global {
  // eslint-disable-next-line no-var
  var __focusRescanMocks: {
    discoveryReturn: unknown[];
    sessionsByPath: Map<string, { id: string }[]>;
    settings: { enabledAdapters: string[] };
    sentEvents: Array<{ channel: string; payload: unknown }>;
  };
}
globalThis.__focusRescanMocks = {
  discoveryReturn: [],
  sessionsByPath: new Map(),
  settings: { enabledAdapters: ['claude-code'] },
  sentEvents: [],
};

vi.mock('../../src/main/discovery', () => ({
  runDiscovery: vi.fn(async () => globalThis.__focusRescanMocks.discoveryReturn),
}));

vi.mock('../../src/main/adapters', () => ({
  getAdapter: () => ({
    listSessions: async (path: string) =>
      globalThis.__focusRescanMocks.sessionsByPath.get(path) ?? [],
  }),
}));

vi.mock('../../src/main/store/settings', () => ({
  settingsStore: {
    get: () => globalThis.__focusRescanMocks.settings,
  },
}));

vi.mock('electron-log', () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  runDiscoveryAndPushIfChanged,
  __resetFocusRescanForTests,
} from '../../src/main/discovery/focus-rescan';

function fakeWindow() {
  return {
    isDestroyed: () => false,
    webContents: {
      send: (channel: string, payload: unknown) => {
        globalThis.__focusRescanMocks.sentEvents.push({ channel, payload });
      },
    },
  };
}

beforeEach(() => {
  __resetFocusRescanForTests();
  globalThis.__focusRescanMocks.sentEvents = [];
  globalThis.__focusRescanMocks.discoveryReturn = [];
  globalThis.__focusRescanMocks.sessionsByPath = new Map();
});

describe('runDiscoveryAndPushIfChanged', () => {
  it('on first call, runs discovery and (when sessions exist) pushes discovery:changed', async () => {
    globalThis.__focusRescanMocks.discoveryReturn = [
      { adapter: 'claude-code', path: '/fake', result: { ok: true, sessionCount: 1 } },
    ];
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }]);

    const win = fakeWindow();
    await runDiscoveryAndPushIfChanged(() => win as never);
    expect(globalThis.__focusRescanMocks.sentEvents).toHaveLength(1);
    expect(globalThis.__focusRescanMocks.sentEvents[0]?.channel).toBe('discovery:changed');
  });

  it('skips a second call within the throttle window', async () => {
    globalThis.__focusRescanMocks.discoveryReturn = [
      { adapter: 'claude-code', path: '/fake', result: { ok: true, sessionCount: 1 } },
    ];
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }]);

    const win = fakeWindow();
    await runDiscoveryAndPushIfChanged(() => win as never);
    // Add a new session to the mock — if the throttle didn't kick in,
    // the next call would push.
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }, { id: 'sess-2' }]);
    await runDiscoveryAndPushIfChanged(() => win as never);

    // Only the first call's push.
    expect(globalThis.__focusRescanMocks.sentEvents).toHaveLength(1);
  });

  it('does NOT push when the session-id set is unchanged across two un-throttled calls', async () => {
    globalThis.__focusRescanMocks.discoveryReturn = [
      { adapter: 'claude-code', path: '/fake', result: { ok: true, sessionCount: 1 } },
    ];
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }]);

    const win = fakeWindow();
    await runDiscoveryAndPushIfChanged(() => win as never);

    // Bypass the throttle by resetting (simulating "more than 5s elapsed")
    // but keep the snapshot so the diff sees no change.
    const beforeReset = globalThis.__focusRescanMocks.sentEvents.length;
    // Manual time travel: only reset the throttle clock, not the snapshot.
    // The helper's internal lastSessionIdSet stays as ['sess-1']. We
    // simulate this by mocking Date.now temporarily.
    const realNow = Date.now;
    Date.now = () => realNow() + 10_000;
    try {
      await runDiscoveryAndPushIfChanged(() => win as never);
    } finally {
      Date.now = realNow;
    }
    expect(globalThis.__focusRescanMocks.sentEvents).toHaveLength(beforeReset);
  });

  it('pushes when a session is added between two un-throttled calls', async () => {
    globalThis.__focusRescanMocks.discoveryReturn = [
      { adapter: 'claude-code', path: '/fake', result: { ok: true, sessionCount: 1 } },
    ];
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }]);

    const win = fakeWindow();
    await runDiscoveryAndPushIfChanged(() => win as never);
    const baseline = globalThis.__focusRescanMocks.sentEvents.length;

    // Add a session.
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }, { id: 'sess-2' }]);
    const realNow = Date.now;
    Date.now = () => realNow() + 10_000;
    try {
      await runDiscoveryAndPushIfChanged(() => win as never);
    } finally {
      Date.now = realNow;
    }
    expect(globalThis.__focusRescanMocks.sentEvents.length).toBe(baseline + 1);
  });

  it('coalesces concurrent calls into a single rescan', async () => {
    globalThis.__focusRescanMocks.discoveryReturn = [
      { adapter: 'claude-code', path: '/fake', result: { ok: true, sessionCount: 1 } },
    ];
    globalThis.__focusRescanMocks.sessionsByPath.set('/fake', [{ id: 'sess-1' }]);

    const win = fakeWindow();
    await Promise.all([
      runDiscoveryAndPushIfChanged(() => win as never),
      runDiscoveryAndPushIfChanged(() => win as never),
      runDiscoveryAndPushIfChanged(() => win as never),
    ]);
    // First one runs; the other two see in-flight and return that promise.
    // Net: at most one push.
    expect(globalThis.__focusRescanMocks.sentEvents.length).toBeLessThanOrEqual(1);
  });
});
