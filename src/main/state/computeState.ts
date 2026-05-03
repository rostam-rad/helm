/**
 * Pure session-state computation.
 *
 * Consumes a snapshot of inputs and returns a SessionState. No I/O, no
 * timers, no mutation. The tracker layer handles side effects (timers,
 * IPC pushes, caching) and calls this function on every tick / event.
 */

import type { Message, SessionState, BlockedReason } from '../../shared/types';

export interface ComputeStateInputs {
  messages: Message[];
  lastEventAt: number;
  permissionMode: string | null;
  now: number;
}

// Tools that require explicit permission under the default mode. When
// permissionMode is 'acceptEdits' / 'bypassPermissions' / 'plan' these
// auto-resolve, so we don't treat them as blockers.
const PERMISSION_GATED_TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit']);

// Per-tool in-flight grace windows. A tool-call with no matching tool-result
// keeps the session in `working` until its tool's grace window expires —
// past that, fall through to `awaiting-user` (genuinely stalled).
//
// Bash and Task get long windows because they routinely run minute+ commands
// (build/test scripts, sub-agents). Read/Edit/Write are fast and should look
// stalled within seconds if no result lands.
const TOOL_GRACE_MS: Record<string, number> = {
  Bash:      600_000,    // 10 min — accommodates tests, builds, npm install
  Task:      1_800_000,  // 30 min — sub-agents can run for a long time
  WebFetch:  60_000,     // 1 min
  WebSearch: 30_000,
  Grep:      30_000,
  Glob:      10_000,
  Read:      5_000,
  Edit:      5_000,
  Write:     5_000,
  MultiEdit: 5_000,
};
const DEFAULT_TOOL_GRACE_MS = 30_000;

function graceForTool(tool: string): number {
  return TOOL_GRACE_MS[tool] ?? DEFAULT_TOOL_GRACE_MS;
}

// Recent-activity window: any event newer than this keeps the session in
// `working`. Sized to bridge the normal pauses Claude takes between writes
// inside a single turn (think → text → next text → tool_use…). Lower values
// caused the working ↔ awaiting flicker the user reported.
const WORKING_RECENT_MS = 90_000;

// "Claude is processing" grace — when the last event is one that *implies*
// Claude must respond (user-prompt, tool-result, assistant-thinking, or
// non-final assistant-text), stay in working for up to this long even with
// no further writes. Long enough to double as crash detection (10 min).
const PROCESSING_GRACE_MS = 10 * 60 * 1000;

// Per-tool permission grace windows. After this long without a tool_result,
// we assume the agent is showing a permission dialog rather than running
// a legitimate long command.
//
// Edit/Write/MultiEdit are fast tools — if they're unanswered for >3s
// something is asking the user. 3s is a tight window because these tools
// genuinely complete in milliseconds when auto-approved.
//
// Bash is the tricky one: legitimate commands can run for tens of seconds
// (npm test, npm install, builds). A 3s window would false-positive every
// test invocation as "PERMISSION", flashing red on every CI run. 8s is
// the empirical sweet spot — long enough that ~95% of "real" Bash commands
// return cleanly within it, short enough that permission dialogs surface
// quickly to a user who's waiting for the agent.
const PERMISSION_GATE_GRACE_BY_TOOL: Record<string, number> = {
  Edit:      3_000,
  Write:     3_000,
  MultiEdit: 3_000,
  Bash:      8_000,
};
const DEFAULT_PERMISSION_GATE_GRACE_MS = 3_000;

function permissionGraceFor(tool: string): number {
  return PERMISSION_GATE_GRACE_BY_TOOL[tool] ?? DEFAULT_PERMISSION_GATE_GRACE_MS;
}

const FRESH_MS = 5 * 60 * 1000;
const RECENT_MS = 60 * 60 * 1000;

/** Events whose presence as the last message means Claude still owes a response.
 *  `assistant-text` is *not* here on purpose — when Claude writes a final text
 *  reply, we want awaiting-user to show eventually. The 90s WORKING_RECENT_MS
 *  is the buffer that bridges normal gaps between assistant events without
 *  delaying the awaiting transition forever. */
function isProcessingTrigger(kind: Message['kind']): boolean {
  return kind === 'user-prompt'
      || kind === 'tool-result'
      || kind === 'assistant-thinking';
}

interface UnansweredToolUse {
  tool: string;
  toolUseId: string;
  ts: string;
  tsMs: number;
}

/** Find the most recent tool_use whose toolUseId has no matching tool_result. */
function findUnansweredToolUse(messages: Message[]): UnansweredToolUse | null {
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.kind === 'tool-result') answered.add(m.toolUseId);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.kind === 'tool-call' && !answered.has(m.toolUseId)) {
      return { tool: m.tool, toolUseId: m.toolUseId, ts: m.ts, tsMs: Date.parse(m.ts) };
    }
  }
  return null;
}

function blockerReasonFor(
  unanswered: UnansweredToolUse,
  permissionMode: string | null,
  now: number,
): BlockedReason | null {
  if (unanswered.tool === 'AskUserQuestion') {
    return { type: 'question', toolUseId: unanswered.toolUseId };
  }
  if (unanswered.tool === 'ExitPlanMode') {
    return { type: 'plan-review', toolUseId: unanswered.toolUseId };
  }

  // Permission detection.
  //
  // The reality on disk: Claude Code only shows a permission dialog when the
  // command isn't on its allow-list. We can't read the allow-list reliably
  // from outside, so we use a time-based heuristic: a permission-gated tool
  // that hasn't returned within its expected runtime is more likely to be
  // waiting on a dialog than legitimately running.
  //
  // `bypassPermissions` mode is the one mode where Claude Code skips dialogs
  // entirely — every command auto-approves. In every other mode (default,
  // acceptEdits, plan), Bash specifically can still trigger a dialog
  // depending on the command. So we run the heuristic for all modes EXCEPT
  // bypassPermissions.
  if (permissionMode === 'bypassPermissions') return null;

  if (PERMISSION_GATED_TOOLS.has(unanswered.tool) &&
      Number.isFinite(unanswered.tsMs) &&
      now - unanswered.tsMs >= permissionGraceFor(unanswered.tool)) {
    return { type: 'permission', tool: unanswered.tool, toolUseId: unanswered.toolUseId };
  }
  return null;
}

function freshnessTier(quietForMs: number): 'fresh' | 'recent' | 'stale' {
  if (quietForMs < FRESH_MS) return 'fresh';
  if (quietForMs < RECENT_MS) return 'recent';
  return 'stale';
}

export function computeState(inputs: ComputeStateInputs): SessionState {
  const { messages, lastEventAt, permissionMode, now } = inputs;
  const sinceQuiet = new Date(lastEventAt).toISOString();
  const unanswered = findUnansweredToolUse(messages);

  // Blocked: a tool_use is waiting on the user.
  if (unanswered) {
    const reason = blockerReasonFor(unanswered, permissionMode, now);
    if (reason !== null) {
      return { kind: 'blocked', since: unanswered.ts, reason };
    }
  }

  // Terminal turn: when Claude's most recent event is an assistant-text with
  // stop_reason === 'end_turn', the turn is genuinely done — skip the 90s
  // recent-activity buffer and flip to awaiting-user immediately. Without
  // this, locked-in users wait up to 90s after Claude finishes for the
  // status badge to reflect "your turn." (Mid-turn assistant-text events
  // have stop_reason === 'tool_use' or undefined, and continue to use the
  // recent-activity window so we don't flicker between blocks.)
  const lastMsg = messages[messages.length - 1];
  if (lastMsg && lastMsg.kind === 'assistant-text' && lastMsg.stopReason === 'end_turn') {
    const elapsed = now - lastEventAt;
    return {
      kind: 'awaiting-user',
      since: sinceQuiet,
      freshnessTier: freshnessTier(elapsed),
    };
  }

  const elapsed = now - lastEventAt;

  // Claude is mid-task: the last event implies more output is coming
  // (user just sent a prompt, a tool just returned, or Claude is mid-thinking).
  // Long crash-grace window so we don't flicker to awaiting during normal
  // API latency between events.
  if (lastMsg && isProcessingTrigger(lastMsg.kind)) {
    const lastMs = Date.parse(lastMsg.ts);
    if (Number.isFinite(lastMs) && now - lastMs < PROCESSING_GRACE_MS) {
      return { kind: 'working', since: sinceQuiet };
    }
  }

  // Working — recent activity (and there is at least one event to be working on),
  // OR an in-flight non-blocking tool_use within its tool-specific grace window.
  if (messages.length > 0 && elapsed < WORKING_RECENT_MS) {
    return { kind: 'working', since: sinceQuiet };
  }
  if (unanswered && now - unanswered.tsMs < graceForTool(unanswered.tool)) {
    return { kind: 'working', since: sinceQuiet };
  }

  // Awaiting-user — pick freshness based on quiet duration.
  return {
    kind: 'awaiting-user',
    since: sinceQuiet,
    freshnessTier: freshnessTier(elapsed),
  };
}
