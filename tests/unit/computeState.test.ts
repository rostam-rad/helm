/**
 * Tests for computeState — the pure function that maps inputs to a SessionState.
 *
 * Covers every case enumerated in the migration spec, plus a few edge cases
 * around grace-window expiry, freshness tier transitions, and blocked tools.
 */

import { describe, it, expect } from 'vitest';
import { computeState } from '../../src/main/state/computeState';
import type { Message } from '../../src/shared/types';

const NOW = new Date('2026-05-03T12:00:00.000Z').getTime();

function tsAt(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

function userPrompt(ageMs: number): Message {
  return { kind: 'user-prompt', uuid: `u-${ageMs}`, ts: tsAt(ageMs), text: 'hello', ideContext: [] };
}
function assistantText(ageMs: number): Message {
  return { kind: 'assistant-text', uuid: `at-${ageMs}`, ts: tsAt(ageMs), text: 'hi', model: 'claude-sonnet-4-6' };
}
function assistantTextEndTurn(ageMs: number): Message {
  return { kind: 'assistant-text', uuid: `at-end-${ageMs}`, ts: tsAt(ageMs), text: 'done!', model: 'claude-sonnet-4-6', stopReason: 'end_turn' };
}
function assistantTextMidTurn(ageMs: number): Message {
  // stop_reason='tool_use' means Claude is about to emit a tool_use next —
  // it's NOT a turn boundary. Stay in working.
  return { kind: 'assistant-text', uuid: `at-mid-${ageMs}`, ts: tsAt(ageMs), text: "I'll edit the file.", model: 'claude-sonnet-4-6', stopReason: 'tool_use' };
}
function toolCall(tool: string, toolUseId: string, ageMs: number): Message {
  return { kind: 'tool-call', uuid: `tc-${toolUseId}`, ts: tsAt(ageMs), tool, toolUseId, input: {} };
}
function toolResult(toolUseId: string, ageMs: number): Message {
  return { kind: 'tool-result', uuid: `tr-${toolUseId}`, ts: tsAt(ageMs), toolUseId, output: 'ok', isError: false };
}

describe('computeState — end_turn short-circuit (responsiveness)', () => {
  it('assistant-text with stopReason=end_turn flips to awaiting-user immediately', () => {
    // The whole point: locked-in users should see "AWAITING" the moment Claude
    // finishes, not 90s later when the recent-activity buffer expires.
    const messages: Message[] = [userPrompt(20_000), assistantTextEndTurn(1_000)];
    const s = computeState({ messages, lastEventAt: NOW - 1_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
    if (s.kind === 'awaiting-user') expect(s.freshnessTier).toBe('fresh');
  });

  it('assistant-text with stopReason=tool_use stays in working (mid-turn, more coming)', () => {
    // Claude said something then will call a tool next — not a turn boundary.
    const messages: Message[] = [userPrompt(20_000), assistantTextMidTurn(1_000)];
    const s = computeState({ messages, lastEventAt: NOW - 1_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('assistant-text with no stopReason falls back to recent-activity window (<90s → working)', () => {
    // No stop_reason captured — the parser may have dropped it. Existing
    // 90s buffer behavior is the fallback.
    const messages: Message[] = [userPrompt(60_000), assistantText(30_000)];
    const s = computeState({ messages, lastEventAt: NOW - 30_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('end_turn 6 minutes ago → awaiting-user with freshnessTier=recent', () => {
    const messages: Message[] = [userPrompt(8 * 60_000), assistantTextEndTurn(6 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 6 * 60_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
    if (s.kind === 'awaiting-user') expect(s.freshnessTier).toBe('recent');
  });

  it('end_turn does NOT override blocked — pending blocker still wins', () => {
    // If somehow the assistant message landed before a tool_result is paired,
    // and there's an unmatched blocking tool, blocked must take priority.
    // In real life Claude never emits end_turn while a tool_use is in flight,
    // but the contract should still be deterministic.
    const messages: Message[] = [
      userPrompt(20_000),
      toolCall('AskUserQuestion', 'q1', 5_000),
      // followed (hypothetically) by an assistant-text end_turn — blocker
      // is older but unanswered. Per the rules, blocked check runs first.
      assistantTextEndTurn(1_000),
    ];
    const s = computeState({ messages, lastEventAt: NOW - 1_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('blocked');
  });
});

describe('computeState — empty + simple', () => {
  it('empty messages → awaiting-user, freshnessTier fresh (lastEventAt = now)', () => {
    const s = computeState({ messages: [], lastEventAt: NOW, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
    if (s.kind === 'awaiting-user') expect(s.freshnessTier).toBe('fresh');
  });

  it('recent assistant text (<2s) → working', () => {
    const messages: Message[] = [userPrompt(10_000), assistantText(500)];
    const s = computeState({ messages, lastEventAt: NOW - 500, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });
});

describe('computeState — Claude processing grace (no flickering)', () => {
  it('user-prompt as last event, 30s ago, no Claude reply yet → working (Claude is processing)', () => {
    // This is the key bug: previously the 2s WORKING_RECENT_MS expired and we flipped to awaiting
    // between the user prompt and Claude's first response event.
    const messages: Message[] = [userPrompt(30_000)];
    const s = computeState({ messages, lastEventAt: NOW - 30_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('user-prompt as last event, 5 min ago, no Claude reply → working (still within crash grace)', () => {
    const messages: Message[] = [userPrompt(5 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 5 * 60_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('user-prompt as last event, 11 min ago → awaiting-user (crash grace expired)', () => {
    const messages: Message[] = [userPrompt(11 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 11 * 60_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });

  it('"[Request interrupted by user]" as last event → awaiting-user immediately', () => {
    const interrupted: Message = { kind: 'user-prompt', uuid: 'int-1', ts: tsAt(5_000), text: '[Request interrupted by user]', ideContext: [] };
    const messages: Message[] = [userPrompt(60_000), interrupted];
    const s = computeState({ messages, lastEventAt: NOW - 5_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });

  it('tool-result as last event, 10s ago → working (Claude is processing the result)', () => {
    const messages: Message[] = [
      userPrompt(60_000),
      toolCall('Bash', 'b1', 50_000),
      toolResult('b1', 10_000),
    ];
    const s = computeState({ messages, lastEventAt: NOW - 10_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('assistant-thinking as last event → working (Claude is mid-thinking)', () => {
    const thinking: Message = { kind: 'assistant-thinking', uuid: 'th-1', ts: tsAt(15_000), text: 'pondering...' };
    const messages: Message[] = [userPrompt(20_000), thinking];
    const s = computeState({ messages, lastEventAt: NOW - 15_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('assistant-text as last event, within 90s recent window → working (gap between events)', () => {
    // The 90s window bridges normal gaps between assistant events within a turn,
    // so we don't flicker to awaiting mid-response.
    const messages: Message[] = [userPrompt(60_000), assistantText(30_000)];
    const s = computeState({ messages, lastEventAt: NOW - 30_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('assistant-text as last event, past 90s recent window → awaiting-user (turn ended)', () => {
    const messages: Message[] = [userPrompt(180_000), assistantText(120_000)];
    const s = computeState({ messages, lastEventAt: NOW - 120_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });
});

describe('computeState — per-tool in-flight grace window', () => {
  it('Read unmatched, <5s old → working (within Read grace)', () => {
    const messages: Message[] = [userPrompt(10_000), toolCall('Read', 'r1', 2_000)];
    const s = computeState({ messages, lastEventAt: NOW - 2_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('Read unmatched past Read grace AND past recent-activity window → awaiting-user', () => {
    // Both the 5s Read grace AND the 90s WORKING_RECENT_MS must be exceeded.
    const messages: Message[] = [userPrompt(120_000), toolCall('Read', 'r2', 100_000)];
    const s = computeState({ messages, lastEventAt: NOW - 100_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });

  it('Bash unmatched, bypassPermissions, 5 min old → working (no dialogs possible)', () => {
    // Long-running builds/tests genuinely run for minutes. The only mode in
    // which we can be sure no permission dialog will fire is bypassPermissions.
    // (Under acceptEdits a Bash >8s is treated as blocked — see the
    // "permission detection across modes" suite.)
    const messages: Message[] = [userPrompt(6 * 60_000), toolCall('Bash', 'b-long', 5 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 5 * 60_000, permissionMode: 'bypassPermissions', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('Bash unmatched, bypassPermissions, 11 min old → awaiting-user (exceeded Bash tool grace)', () => {
    const messages: Message[] = [userPrompt(12 * 60_000), toolCall('Bash', 'b-stalled', 11 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 11 * 60_000, permissionMode: 'bypassPermissions', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });

  it('Task unmatched, 25 min old → working (sub-agents legitimately run long)', () => {
    const messages: Message[] = [userPrompt(30 * 60_000), toolCall('Task', 't-subagent', 25 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 25 * 60_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('Unknown tool unmatched falls back to default 30s grace — under threshold → working', () => {
    const messages: Message[] = [userPrompt(40_000), toolCall('SomeMcpTool', 'mcp1', 20_000)];
    const s = computeState({ messages, lastEventAt: NOW - 20_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('Unknown tool unmatched past default 30s grace AND past recent window → awaiting-user', () => {
    const messages: Message[] = [userPrompt(120_000), toolCall('SomeMcpTool', 'mcp2', 100_000)];
    const s = computeState({ messages, lastEventAt: NOW - 100_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });
});

describe('computeState — permission detection across modes', () => {
  it('Edit unmatched in acceptEdits, ≥3s → blocked.permission (fast tool stuck = something is asking)', () => {
    const messages: Message[] = [userPrompt(10_000), toolCall('Edit', 'e1', 4_000)];
    const s = computeState({ messages, lastEventAt: NOW - 4_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked') expect(s.reason.type).toBe('permission');
  });

  it('Write unmatched with no permissionMode set, ≥3s → blocked.permission', () => {
    const messages: Message[] = [userPrompt(10_000), toolCall('Write', 'w1', 5_000)];
    const s = computeState({ messages, lastEventAt: NOW - 5_000, permissionMode: null, now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked') expect(s.reason.type).toBe('permission');
  });

  it('Bash unmatched in acceptEdits, 5s old → working (under Bash 8s permission grace)', () => {
    // Bash has a longer permission grace (8s) than other tools because real
    // Bash commands routinely take a few seconds. 5s is squarely "still
    // running" territory — don't false-positive a quick `npm run lint`.
    const messages: Message[] = [userPrompt(10_000), toolCall('Bash', 'b1', 5_000)];
    const s = computeState({ messages, lastEventAt: NOW - 5_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('Bash unmatched in acceptEdits, 9s old → blocked.permission (likely a permission dialog)', () => {
    // The bug this fixes: "Allow this bash command?" dialogs appear under
    // acceptEdits too, not just default mode. Most legitimate Bash commands
    // return within ~8s; if it's still pending past that, it's almost
    // certainly a permission prompt.
    const messages: Message[] = [userPrompt(15_000), toolCall('Bash', 'b-prompt', 9_000)];
    const s = computeState({ messages, lastEventAt: NOW - 9_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked') {
      expect(s.reason.type).toBe('permission');
      if (s.reason.type === 'permission') expect(s.reason.tool).toBe('Bash');
    }
  });

  it('Bash unmatched in default mode, 9s old → blocked.permission', () => {
    const messages: Message[] = [userPrompt(15_000), toolCall('Bash', 'b-default', 9_000)];
    const s = computeState({ messages, lastEventAt: NOW - 9_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked') expect(s.reason.type).toBe('permission');
  });

  it('Bash unmatched in plan mode, 9s old → blocked.permission', () => {
    // plan mode also gates Bash.
    const messages: Message[] = [userPrompt(15_000), toolCall('Bash', 'b-plan', 9_000)];
    const s = computeState({ messages, lastEventAt: NOW - 9_000, permissionMode: 'plan', now: NOW });
    expect(s.kind).toBe('blocked');
  });

  it('Bash unmatched in bypassPermissions, 9s old → working (no dialog ever)', () => {
    // bypassPermissions is the only mode that auto-approves everything.
    // No permission dialog can fire, so a long-running Bash here is
    // genuinely working, not blocked. (npm test running 9s is normal.)
    const messages: Message[] = [userPrompt(15_000), toolCall('Bash', 'b-bypass', 9_000)];
    const s = computeState({ messages, lastEventAt: NOW - 9_000, permissionMode: 'bypassPermissions', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('Bash unmatched in bypassPermissions, 11min old → awaiting-user (exceeded tool grace, not blocked)', () => {
    // After exceeding the 10min Bash tool-grace, fall through to awaiting,
    // not blocked — bypassPermissions can never produce a permission block.
    const messages: Message[] = [userPrompt(12 * 60_000), toolCall('Bash', 'b-stuck', 11 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 11 * 60_000, permissionMode: 'bypassPermissions', now: NOW });
    expect(s.kind).toBe('awaiting-user');
  });
});

describe('computeState — blocked', () => {
  it('AskUserQuestion unmatched → blocked with reason.type === question (instant, no grace)', () => {
    const messages: Message[] = [userPrompt(5_000), toolCall('AskUserQuestion', 'q1', 1_000)];
    const s = computeState({ messages, lastEventAt: NOW - 1_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked') {
      expect(s.reason.type).toBe('question');
      if (s.reason.type === 'question') expect(s.reason.toolUseId).toBe('q1');
    }
  });

  it('ExitPlanMode unmatched → blocked with reason.type === plan-review', () => {
    const messages: Message[] = [userPrompt(5_000), toolCall('ExitPlanMode', 'p1', 1_000)];
    const s = computeState({ messages, lastEventAt: NOW - 1_000, permissionMode: 'plan', now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked') expect(s.reason.type).toBe('plan-review');
  });

  it('Bash unmatched, permissionMode=default, ≥8s → blocked with reason.type === permission', () => {
    const messages: Message[] = [userPrompt(15_000), toolCall('Bash', 'b1', 9_000)];
    const s = computeState({ messages, lastEventAt: NOW - 9_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('blocked');
    if (s.kind === 'blocked' && s.reason.type === 'permission') {
      expect(s.reason.tool).toBe('Bash');
      expect(s.reason.toolUseId).toBe('b1');
    }
  });

  it('Bash unmatched <8s → working (gate grace), then blocked once gate expires', () => {
    // Bash specifically uses an 8s permission grace (vs 3s for fast tools)
    // because real Bash commands routinely run for several seconds.
    const messages: Message[] = [userPrompt(5_000), toolCall('Bash', 'b2', 1_500)];
    const s1 = computeState({ messages, lastEventAt: NOW - 1_500, permissionMode: 'default', now: NOW });
    expect(s1.kind).toBe('working');

    // Advance clock so the Bash is now ≥8s old.
    const s2 = computeState({ messages, lastEventAt: NOW - 1_500, permissionMode: 'default', now: NOW + 7_000 });
    expect(s2.kind).toBe('blocked');
  });

  it('Bash unmatched, permissionMode=acceptEdits, 5s → working (under 8s Bash gate)', () => {
    // Still working at 5s; once Bash crosses 8s under acceptEdits, the
    // "permission detection across modes" suite covers the blocked transition.
    const messages: Message[] = [userPrompt(10_000), toolCall('Bash', 'b3', 5_000)];
    const s = computeState({ messages, lastEventAt: NOW - 5_000, permissionMode: 'acceptEdits', now: NOW });
    expect(s.kind).toBe('working');
  });

  it('blocking tool answered by matching tool_result → resolves out of blocked', () => {
    const messages: Message[] = [
      userPrompt(20_000),
      toolCall('AskUserQuestion', 'q9', 10_000),
      toolResult('q9', 5_000),
    ];
    const s = computeState({ messages, lastEventAt: NOW - 5_000, permissionMode: 'default', now: NOW });
    expect(s.kind).not.toBe('blocked');
  });
});

describe('computeState — freshness tiers', () => {
  it('quiet >5min → awaiting-user with freshnessTier === recent', () => {
    const messages: Message[] = [userPrompt(10 * 60_000), assistantText(6 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 6 * 60_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
    if (s.kind === 'awaiting-user') expect(s.freshnessTier).toBe('recent');
  });

  it('quiet >60min → awaiting-user with freshnessTier === stale', () => {
    const messages: Message[] = [userPrompt(120 * 60_000), assistantText(90 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 90 * 60_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
    if (s.kind === 'awaiting-user') expect(s.freshnessTier).toBe('stale');
  });

  it('quiet <5min → awaiting-user with freshnessTier === fresh', () => {
    const messages: Message[] = [assistantText(2 * 60_000)];
    const s = computeState({ messages, lastEventAt: NOW - 2 * 60_000, permissionMode: 'default', now: NOW });
    expect(s.kind).toBe('awaiting-user');
    if (s.kind === 'awaiting-user') expect(s.freshnessTier).toBe('fresh');
  });
});

describe('computeState — purity', () => {
  it('does not mutate the messages array', () => {
    const messages: Message[] = [userPrompt(1_000), toolCall('Read', 'p1', 500)];
    const snapshot = JSON.stringify(messages);
    computeState({ messages, lastEventAt: NOW - 500, permissionMode: 'default', now: NOW });
    expect(JSON.stringify(messages)).toBe(snapshot);
  });

  it('two identical inputs produce identical outputs', () => {
    const messages: Message[] = [userPrompt(2_000), assistantText(1_500)];
    const inputs = { messages, lastEventAt: NOW - 1_500, permissionMode: 'default', now: NOW };
    expect(computeState(inputs)).toEqual(computeState(inputs));
  });
});
