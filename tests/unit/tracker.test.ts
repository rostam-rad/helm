/**
 * Tests for the StateTracker — the side-effects layer above computeState.
 *
 * Focus areas (per migration spec correction #2 and #3):
 *   - permissionMode is cached per session and applied to subsequent events
 *     that lack the field
 *   - lastUserInputAt updates only on user-prompt messages, not on tool-result
 *     (which are user-typed events but produced by the agent) and not while
 *     the agent is running through a long turn
 */

import { describe, it, expect } from 'vitest';
import { StateTracker } from '../../src/main/state/tracker';
import type { Message } from '../../src/shared/types';

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function tsAt(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function userPrompt(ageMs: number, opts: { permissionMode?: string } = {}): Message {
  return {
    kind: 'user-prompt', uuid: `u-${ageMs}-${Math.random()}`, ts: tsAt(ageMs),
    text: 'hello', ideContext: [],
    ...(opts.permissionMode !== undefined ? { permissionMode: opts.permissionMode } : {}),
  };
}
function assistantText(ageMs: number): Message {
  return { kind: 'assistant-text', uuid: `at-${ageMs}-${Math.random()}`, ts: tsAt(ageMs), text: 'hi', model: 'claude-sonnet-4-6' };
}
function toolCall(tool: string, toolUseId: string, ageMs: number): Message {
  return { kind: 'tool-call', uuid: `tc-${toolUseId}`, ts: tsAt(ageMs), tool, toolUseId, input: {} };
}
function toolResult(toolUseId: string, ageMs: number): Message {
  return { kind: 'tool-result', uuid: `tr-${toolUseId}`, ts: tsAt(ageMs), toolUseId, output: 'ok', isError: false };
}

describe('StateTracker — permissionMode caching', () => {
  it('seeds with the provided permissionMode and applies it to computeState', () => {
    const t = new StateTracker();
    t.seed('s1', {
      messages: [userPrompt(2_000)],
      lastEventAt: NOW - 2_000,
      permissionMode: 'acceptEdits',
    });
    expect(t.getPermissionMode('s1')).toBe('acceptEdits');
  });

  it('sniffs permissionMode from a user-prompt in the seed messages when not provided', () => {
    const t = new StateTracker();
    t.seed('s1', {
      messages: [userPrompt(2_000, { permissionMode: 'plan' })],
      lastEventAt: NOW - 2_000,
    });
    expect(t.getPermissionMode('s1')).toBe('plan');
  });

  it('caches permissionMode from a past user event and applies it to a later assistant event that lacks the field', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW - 60_000 });
    expect(t.getPermissionMode('s1')).toBe(null);

    // First user event carries permissionMode.
    t.ingest('s1', userPrompt(50_000, { permissionMode: 'acceptEdits' }));
    expect(t.getPermissionMode('s1')).toBe('acceptEdits');

    // Subsequent assistant event lacks the field — cache must persist.
    t.ingest('s1', assistantText(5_000));
    expect(t.getPermissionMode('s1')).toBe('acceptEdits');
  });

  it('updates the cached permissionMode when a later user-prompt carries a different value', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW });
    t.ingest('s1', userPrompt(10_000, { permissionMode: 'default' }));
    expect(t.getPermissionMode('s1')).toBe('default');
    t.ingest('s1', userPrompt(1_000, { permissionMode: 'acceptEdits' }));
    expect(t.getPermissionMode('s1')).toBe('acceptEdits');
  });

  it('does not change permissionMode when a tool-result arrives (tool-results are not human input)', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW, permissionMode: 'plan' });
    t.ingest('s1', toolCall('Read', 'r1', 1_000));
    t.ingest('s1', toolResult('r1', 500));
    expect(t.getPermissionMode('s1')).toBe('plan');
  });
});

describe('StateTracker — lastUserInputAt', () => {
  it('returns null when no user-prompt has been observed', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW });
    expect(t.getPayload('s1')?.lastUserInputAt).toBe(null);
  });

  it('updates lastUserInputAt when a user-prompt arrives', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW });
    expect(t.getPayload('s1')?.lastUserInputAt).toBe(null);
    const msg = userPrompt(5_000);
    t.ingest('s1', msg);
    expect(t.getPayload('s1')?.lastUserInputAt).toBe(Date.parse(msg.ts));
  });

  it('does NOT update lastUserInputAt when a tool-result arrives', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW });
    const userMsg = userPrompt(60_000);
    t.ingest('s1', userMsg);
    const userMsgTs = Date.parse(userMsg.ts);

    // Agent runs a tool; the tool-result is a user-typed event in the JSONL.
    t.ingest('s1', toolCall('Read', 'r1', 30_000));
    t.ingest('s1', toolResult('r1', 25_000));
    expect(t.getPayload('s1')?.lastUserInputAt).toBe(userMsgTs);
  });

  it('does NOT change lastUserInputAt while the agent is running through a long turn', () => {
    const t = new StateTracker();
    t.seed('s1', { messages: [], lastEventAt: NOW });
    const userMsg = userPrompt(120_000);
    t.ingest('s1', userMsg);
    const expectedTs = Date.parse(userMsg.ts);

    // Long agent turn: many assistant events, tool calls, tool results.
    t.ingest('s1', assistantText(100_000));
    t.ingest('s1', toolCall('Bash', 'b1', 90_000));
    t.ingest('s1', toolResult('b1', 60_000));
    t.ingest('s1', assistantText(55_000));
    t.ingest('s1', toolCall('Edit', 'e1', 40_000));
    t.ingest('s1', toolResult('e1', 35_000));
    t.ingest('s1', assistantText(10_000));

    expect(t.getPayload('s1')?.lastUserInputAt).toBe(expectedTs);
  });

  it('sniffs lastUserInputAt from seed messages when not explicitly provided', () => {
    const t = new StateTracker();
    const u1 = userPrompt(60_000);
    const u2 = userPrompt(20_000);
    t.seed('s1', {
      messages: [u1, assistantText(50_000), u2, assistantText(10_000)],
      lastEventAt: NOW - 10_000,
    });
    // Most recent user-prompt wins.
    expect(t.getPayload('s1')?.lastUserInputAt).toBe(Date.parse(u2.ts));
  });
});

describe('StateTracker — listener', () => {
  it('fires the listener with the new state and lastUserInputAt when state changes', () => {
    const t = new StateTracker();
    const fired: Array<{ id: string; lastUserInputAt: number | null; kind: string }> = [];
    t.setListener((id, payload) => {
      fired.push({ id, lastUserInputAt: payload.lastUserInputAt, kind: payload.state.kind });
    });

    t.seed('s1', { messages: [], lastEventAt: NOW });
    // Seeding does not fire (it returns the initial payload directly).
    expect(fired).toHaveLength(0);

    // Ingest a user prompt that immediately puts us into working.
    const u = userPrompt(0);
    t.ingest('s1', u);
    expect(fired.length).toBeGreaterThan(0);
    const last = fired[fired.length - 1];
    expect(last?.kind).toBe('working');
    expect(last?.lastUserInputAt).toBe(Date.parse(u.ts));
  });
});
