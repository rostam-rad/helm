/**
 * Tests for installNotifications. Mocks electron.Notification so we can
 * assert what would have been shown without actually firing native
 * notifications during the test run.
 *
 * Each test simulates a state transition by driving the tracker with
 * .seed() (sets initial state) followed by .ingest() (which recomputes
 * and fires the listener). The notifications module's lastSeenKind map
 * tracks transitions across ingest calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FiredNotification {
  title: string;
  body: string;
  click?: () => void;
}

declare global {
  // eslint-disable-next-line no-var
  var __notifMocks: {
    fired: FiredNotification[];
    isSupported: boolean;
  };
}
globalThis.__notifMocks = { fired: [], isSupported: true };

vi.mock('electron', () => {
  class MockNotification {
    private opts: { title: string; body: string };
    private clickHandler?: () => void;
    constructor(opts: { title: string; body: string }) { this.opts = opts; }
    on(event: string, handler: () => void) {
      if (event === 'click') this.clickHandler = handler;
    }
    show() {
      const fired: FiredNotification = { title: this.opts.title, body: this.opts.body };
      if (this.clickHandler) fired.click = this.clickHandler;
      globalThis.__notifMocks.fired.push(fired);
    }
    static isSupported() { return globalThis.__notifMocks.isSupported; }
  }
  return { Notification: MockNotification };
});

vi.mock('electron-log', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { StateTracker } from '../../src/main/state/tracker';
import { installNotifications } from '../../src/main/notifications';
import type { Message, SessionMeta, SessionState } from '../../src/shared/types';
import type { AppSettings, NotificationMode } from '../../src/shared/ipc-contract';

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function makeMeta(id: string, projectLabel = 'demo-project'): SessionMeta {
  return {
    id,
    adapter: 'claude-code',
    cwd: '/x',
    projectLabel,
    filePath: '/x/x.jsonl',
    gitBranch: null,
    startedAt: new Date(NOW - 60_000).toISOString(),
    lastActivityAt: new Date(NOW).toISOString(),
    lastUserInputAt: null,
    state: { kind: 'working', since: '' },
    isSidechain: false,
    parentSessionId: null,
    messageCount: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    model: null,
    modelClass: 'cloud',
    modelProvider: null,
    permissionMode: null,
    entrypoint: null,
    agentVersion: null,
    firstUserMessage: null,
  };
}

function userPrompt(uuid: string, ts: number): Message {
  return { kind: 'user-prompt', uuid, ts: new Date(ts).toISOString(), text: 'hi', ideContext: [] };
}
function assistantText(uuid: string, ts: number, text = 'sure', stopReason: string | undefined = 'end_turn'): Message {
  const m: Message = { kind: 'assistant-text', uuid, ts: new Date(ts).toISOString(), text, model: 'claude-x' };
  if (stopReason !== undefined) (m as { stopReason?: string }).stopReason = stopReason;
  return m;
}
function toolCall(uuid: string, ts: number, tool: string, toolUseId: string): Message {
  return { kind: 'tool-call', uuid, ts: new Date(ts).toISOString(), tool, toolUseId, input: {} };
}

/** Force the tracker into a specific state-kind for a session by seeding
 *  with a synthetic snapshot, then bouncing through an ingest that
 *  recomputes to the desired kind. We use this instead of pushing real
 *  message sequences for every test — the state machine is already
 *  tested elsewhere; here we only care about the listener fanout.
 *
 *  Returns a "fire transition" function that updates the cached state to
 *  the next kind and synthesizes a listener call as if the tracker
 *  computed it. This lets us drive the notifications module
 *  deterministically without depending on grace-window timing. */
function makeDriver(tracker: StateTracker, sessionId: string) {
  // Prime the listener with a known starting kind by seeding with one
  // user-prompt (-> working). The notifications module's lastSeenKind
  // is set by the *first* listener call, not by seed itself, so we
  // also fire a synthetic transition to record 'working'.
  return {
    /** Synthesize a state transition by directly modifying the cached
     *  entry and invoking the listener. */
    transitionTo(state: SessionState) {
      const entry = (tracker as unknown as { entries: Map<string, { state: SessionState; messages: Message[]; lastEventAt: number; permissionMode: string | null; lastUserInputAt: number | null }> }).entries.get(sessionId);
      if (!entry) throw new Error('seed first');
      entry.state = state;
      // Manually invoke the registered listeners (we can't go through
      // recompute because the pure state machine wouldn't yield arbitrary
      // states from arbitrary inputs).
      const listeners = (tracker as unknown as { listeners: Set<(id: string, p: { state: SessionState; lastUserInputAt: number | null }) => void> }).listeners;
      for (const fn of listeners) {
        fn(sessionId, { state, lastUserInputAt: entry.lastUserInputAt });
      }
    },
    pushMessage(m: Message) {
      const entry = (tracker as unknown as { entries: Map<string, { messages: Message[] }> }).entries.get(sessionId);
      if (entry) entry.messages.push(m);
    },
  };
}

function makeDeps(opts: { mode: NotificationMode; tracker: StateTracker; meta: SessionMeta }) {
  let currentMode = opts.mode;
  const settings: AppSettings = {
    theme: 'system',
    enabledAdapters: ['claude-code'],
    customPaths: [],
    notifications: { mode: currentMode },
  };
  const getSettings = () => ({ ...settings, notifications: { mode: currentMode } });
  const setMode = (m: NotificationMode) => { currentMode = m; };
  return {
    deps: {
      tracker: opts.tracker,
      getWindow: () => null,
      getSettings,
      getMeta: (id: string): SessionMeta | undefined => id === opts.meta.id ? opts.meta : undefined,
      getMessages: (id: string) => opts.tracker.getMessages(id),
    },
    setMode,
  };
}

beforeEach(() => {
  globalThis.__notifMocks.fired = [];
  globalThis.__notifMocks.isSupported = true;
});

describe('installNotifications', () => {
  it('mode "off" fires no notifications for any transition', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'off', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'permission', tool: 'Bash', toolUseId: 't1' } });
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'fresh' });

    expect(globalThis.__notifMocks.fired).toHaveLength(0);
  });

  it('blocked-only + working → blocked(permission, Bash) fires expected title and body', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1', 'helm');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-only', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'permission', tool: 'Bash', toolUseId: 't1' } });

    expect(globalThis.__notifMocks.fired).toHaveLength(1);
    expect(globalThis.__notifMocks.fired[0]?.title).toBe('helm needs you');
    expect(globalThis.__notifMocks.fired[0]?.body).toBe('Permission required: Bash');
  });

  it('blocked-only + working → blocked(question) body says "Claude is asking a question"', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1', 'helm');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-only', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'question', toolUseId: 'q1' } });

    expect(globalThis.__notifMocks.fired[0]?.body).toBe('Claude is asking a question');
  });

  it('blocked-only + working → blocked(plan-review) body says "Plan ready for review"', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1', 'helm');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-only', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'plan-review', toolUseId: 'p1' } });

    expect(globalThis.__notifMocks.fired[0]?.body).toBe('Plan ready for review');
  });

  it('blocked-only + working → awaiting-user does NOT fire', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-only', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'fresh' });

    expect(globalThis.__notifMocks.fired).toHaveLength(0);
  });

  it('blocked-and-finished + working → awaiting-user with assistant-text fires with first 80 chars', () => {
    const longText = 'A'.repeat(120);
    const tracker = new StateTracker();
    const meta = makeMeta('s1', 'demo');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-and-finished', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.pushMessage(assistantText('a1', NOW + 1, longText, 'end_turn'));
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'fresh' });

    expect(globalThis.__notifMocks.fired).toHaveLength(1);
    expect(globalThis.__notifMocks.fired[0]?.title).toBe('demo — turn finished');
    const body = globalThis.__notifMocks.fired[0]?.body ?? '';
    expect(body.length).toBeLessThanOrEqual(80);
    expect(body.endsWith('…')).toBe(true);
  });

  it('blocked-and-finished + working → awaiting-user with no assistant text uses fallback body', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-and-finished', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'fresh' });

    expect(globalThis.__notifMocks.fired[0]?.body).toBe('Claude is ready for your next prompt');
  });

  it('does not fire for freshness-tier-only changes (fresh → recent)', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-and-finished', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    // Prime with awaiting-user fresh, then transition to awaiting-user recent.
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'fresh' });
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'recent' });

    expect(globalThis.__notifMocks.fired).toHaveLength(0);
  });

  it('does not fire for awaiting-user → working (only working → X transitions notify)', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-and-finished', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'awaiting-user', since: '', freshnessTier: 'fresh' });
    drv.transitionTo({ kind: 'working', since: '' });

    expect(globalThis.__notifMocks.fired).toHaveLength(0);
  });

  it('reads settings fresh per transition: mid-flight mode change takes effect', () => {
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps, setMode } = makeDeps({ mode: 'off', tracker, meta });
    installNotifications(deps);

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'permission', tool: 'Bash', toolUseId: 't1' } });
    expect(globalThis.__notifMocks.fired).toHaveLength(0); // mode: 'off'

    setMode('blocked-only');
    // Same transition again (working → blocked).
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'permission', tool: 'Edit', toolUseId: 't2' } });
    expect(globalThis.__notifMocks.fired).toHaveLength(1);
    expect(globalThis.__notifMocks.fired[0]?.body).toBe('Permission required: Edit');
  });

  it('returns a no-op unsubscribe and skips install when Notification.isSupported() is false', () => {
    globalThis.__notifMocks.isSupported = false;
    const tracker = new StateTracker();
    const meta = makeMeta('s1');
    tracker.seed('s1', { messages: [userPrompt('u', NOW)], lastEventAt: NOW });
    const { deps } = makeDeps({ mode: 'blocked-only', tracker, meta });
    const unsubscribe = installNotifications(deps);
    expect(typeof unsubscribe).toBe('function');

    const drv = makeDriver(tracker, 's1');
    drv.transitionTo({ kind: 'working', since: '' });
    drv.transitionTo({ kind: 'blocked', since: '', reason: { type: 'permission', tool: 'Bash', toolUseId: 't1' } });

    expect(globalThis.__notifMocks.fired).toHaveLength(0);
  });
});

// Suppress unused-import warnings for helpers reserved for future tests.
void toolCall;
