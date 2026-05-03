/**
 * Types shared between the main process and the renderer.
 * These are the contract that the IPC layer enforces.
 *
 * Design notes:
 * - SessionMeta is the lightweight record returned by listSessions().
 *   It must be cheap to compute — anything expensive lives in parseSession().
 * - Message is a discriminated union by `kind`. The renderer switches on
 *   `kind` to decide how to render. New kinds added here require explicit
 *   handling in the renderer; the compiler will surface missing cases.
 * - `kind: 'unknown'` is the forward-compat escape hatch — anything we
 *   don't recognise becomes one of these and gets logged, not thrown.
 */

export type AdapterId = 'claude-code' | 'codex' | 'aider' | 'cline';

export type ModelClass = 'cloud' | 'local' | 'unknown';

export type BlockedReason =
  | { type: 'permission';  tool: string; toolUseId: string }
  | { type: 'question';    toolUseId: string }
  | { type: 'plan-review'; toolUseId: string };

export type SessionState =
  | { kind: 'working';       since: string }
  | { kind: 'blocked';       since: string; reason: BlockedReason }
  | { kind: 'awaiting-user'; since: string; freshnessTier: 'fresh' | 'recent' | 'stale' };

export interface SessionMeta {
  id: string;
  adapter: AdapterId;
  cwd: string;
  projectLabel: string;
  filePath: string;
  gitBranch: string | null;
  startedAt: string;        // ISO timestamps over the IPC wire — Date doesn't survive structured-clone cleanly
  lastActivityAt: string;
  /** ISO timestamp of the most recent user-prompt message, if any. Used by
   *  the renderer to display "waiting on you for X minutes" without conflating
   *  with agent-side activity (tool calls, assistant text). */
  lastUserInputAt: string | null;
  state: SessionState;
  isSidechain: boolean;
  parentSessionId: string | null;
  messageCount: number;
  totalTokens: number;
  totalCostUsd: number;
  model: string | null;
  modelClass: ModelClass;
  modelProvider: string | null;
  permissionMode: string | null;
  entrypoint: string | null;
  agentVersion: string | null;
  firstUserMessage: string | null;
}

export type ToolName =
  | 'Bash'
  | 'Read'
  | 'Edit'
  | 'Write'
  | 'Task'
  | 'Glob'
  | 'Grep'
  | 'TodoWrite'
  | 'WebFetch'
  | 'WebSearch'
  | string; // open-ended for MCP tools (mcp__*) and unknown tools

export type Message =
  | { kind: 'user-prompt'; uuid: string; ts: string; text: string; ideContext: string[]; permissionMode?: string }
  | { kind: 'assistant-text'; uuid: string; ts: string; text: string; model: string | null; stopReason?: string }
  | { kind: 'assistant-thinking'; uuid: string; ts: string; text: string }
  | { kind: 'tool-call'; uuid: string; ts: string; tool: ToolName; toolUseId: string; input: unknown }
  | { kind: 'tool-result'; uuid: string; ts: string; toolUseId: string; output: string; isError: boolean }
  | { kind: 'env-metadata'; uuid: string; ts: string; subtype: string; data: unknown }
  | { kind: 'assistant-usage'; uuid: string; ts: string; inputTokens: number; outputTokens: number; cacheReadTokens: number }
  | { kind: 'session-result'; uuid: string; ts: string; costUsd: number }
  | { kind: 'unknown'; uuid: string; ts: string; raw: unknown };

export type ValidationResult =
  | { ok: true; sessionCount: number }
  | { ok: false; reason: string };
