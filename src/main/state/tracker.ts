/**
 * Per-session state tracker.
 *
 * Owns the side-effects layer above the pure computeState():
 *  - caches the message tail per session
 *  - caches the most recently observed permissionMode (sticky — once seen on a
 *    user event, applied to all subsequent events that lack the field)
 *  - tracks lastUserInputAt: the ISO timestamp of the most recent user-prompt,
 *    *not* updated by tool results (which are user-typed events but produced
 *    by the agent) or by anything else
 *  - runs a 1s tick to catch grace-window expiry and freshness transitions
 *  - emits an onChange callback when state, permissionMode, or
 *    lastUserInputAt changes (the renderer needs all three)
 */

import type { Message, SessionState } from '../../shared/types';
import { computeState } from './computeState';

interface SessionEntry {
  messages: Message[];
  lastEventAt: number;
  permissionMode: string | null;
  lastUserInputAt: number | null;
  state: SessionState;
}

export interface TrackerPayload {
  state: SessionState;
  lastUserInputAt: number | null;
}

type ChangeListener = (sessionId: string, payload: TrackerPayload) => void;

export interface SeedArgs {
  messages: Message[];
  lastEventAt: number;
  permissionMode?: string | null;
  lastUserInputAt?: number | null;
}

export class StateTracker {
  private entries = new Map<string, SessionEntry>();
  private listener: ChangeListener | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;

  setListener(fn: ChangeListener | null): void {
    this.listener = fn;
  }

  /** Replace the cached state for a session — used on initial load. */
  seed(sessionId: string, args: SeedArgs): TrackerPayload {
    // If we're seeding fresh and no permissionMode was passed, derive it from
    // the most recent user-prompt that carried one.
    const sniffedPermission = args.permissionMode ?? sniffPermissionMode(args.messages);
    const sniffedLastUser = args.lastUserInputAt ?? sniffLastUserInputAt(args.messages);
    const entry: SessionEntry = {
      messages: args.messages,
      lastEventAt: args.lastEventAt,
      permissionMode: sniffedPermission,
      lastUserInputAt: sniffedLastUser,
      state: computeState({
        messages: args.messages,
        lastEventAt: args.lastEventAt,
        permissionMode: sniffedPermission,
        now: Date.now(),
      }),
    };
    this.entries.set(sessionId, entry);
    this.startTickIfNeeded();
    return { state: entry.state, lastUserInputAt: entry.lastUserInputAt };
  }

  /** Append a single new message. Updates permissionMode and lastUserInputAt
   *  per the rules above before recomputing. */
  ingest(sessionId: string, message: Message, lastEventAt: number = Date.now()): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.messages.push(message);
    entry.lastEventAt = lastEventAt;

    if (message.kind === 'user-prompt') {
      // Real human input — update lastUserInputAt and capture any
      // permissionMode the event carried.
      entry.lastUserInputAt = Date.parse(message.ts) || lastEventAt;
      if (typeof message.permissionMode === 'string') {
        entry.permissionMode = message.permissionMode;
      }
    }
    // tool-result is also a `user`-typed event in the JSONL but it isn't
    // human typing — we deliberately do not touch lastUserInputAt for it.

    this.recompute(sessionId);
  }

  /** Drop a session's tracked state (e.g. when removed from discovery). */
  forget(sessionId: string): void {
    this.entries.delete(sessionId);
    if (this.entries.size === 0) this.stopTick();
  }

  forgetAll(): void {
    this.entries.clear();
    this.stopTick();
  }

  getPayload(sessionId: string): TrackerPayload | undefined {
    const entry = this.entries.get(sessionId);
    if (!entry) return undefined;
    return { state: entry.state, lastUserInputAt: entry.lastUserInputAt };
  }

  getPermissionMode(sessionId: string): string | null | undefined {
    return this.entries.get(sessionId)?.permissionMode;
  }

  private recompute(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    const next = computeState({
      messages: entry.messages,
      lastEventAt: entry.lastEventAt,
      permissionMode: entry.permissionMode,
      now: Date.now(),
    });
    const stateChanged = !statesEqual(entry.state, next);
    entry.state = next;
    if (stateChanged) {
      this.listener?.(sessionId, { state: next, lastUserInputAt: entry.lastUserInputAt });
    }
  }

  private startTickIfNeeded(): void {
    if (this.tick) return;
    this.tick = setInterval(() => {
      for (const id of this.entries.keys()) this.recompute(id);
    }, 1000);
    this.tick.unref?.();
  }

  private stopTick(): void {
    if (!this.tick) return;
    clearInterval(this.tick);
    this.tick = null;
  }
}

function sniffPermissionMode(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.kind === 'user-prompt' && typeof m.permissionMode === 'string') {
      return m.permissionMode;
    }
  }
  return null;
}

function sniffLastUserInputAt(messages: Message[]): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.kind === 'user-prompt') {
      const ts = Date.parse(m.ts);
      return Number.isFinite(ts) ? ts : null;
    }
  }
  return null;
}

function statesEqual(a: SessionState, b: SessionState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'awaiting-user' && b.kind === 'awaiting-user') {
    return a.freshnessTier === b.freshnessTier;
  }
  if (a.kind === 'blocked' && b.kind === 'blocked') {
    if (a.reason.type !== b.reason.type) return false;
    if (a.reason.type === 'permission' && b.reason.type === 'permission') {
      return a.reason.tool === b.reason.tool && a.reason.toolUseId === b.reason.toolUseId;
    }
    if (
      (a.reason.type === 'question' && b.reason.type === 'question') ||
      (a.reason.type === 'plan-review' && b.reason.type === 'plan-review')
    ) {
      return a.reason.toolUseId === b.reason.toolUseId;
    }
  }
  return true;
}
