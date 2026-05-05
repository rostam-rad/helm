/**
 * Native OS notifications wired to tracker state-change events.
 *
 * Why `mode` is a single setting and not two booleans:
 *
 * 'blocked' transitions are rare and high-value: a session is genuinely
 * stalled until the user acts. 'awaiting-user' transitions happen 5–30+
 * times per typical session — every tool-result-followed-by-end_turn.
 * Independent toggles would let a user enable 'finished' alone (without
 * 'blocked'), which is almost never what they want and degrades signal-
 * to-noise.
 *
 * The radio-style mode forces a deliberate choice: silent, high-signal,
 * or chatty. If users ask for finer control (e.g. per-session pings),
 * revisit in v0.3 — ship the simple model first.
 */

import { Notification, type BrowserWindow } from 'electron';
import log from 'electron-log';
import type { StateTracker, TrackerPayload } from '../state/tracker';
import type { Message, SessionMeta, SessionState } from '../../shared/types';
import type { AppSettings } from '../../shared/ipc-contract';

export interface NotificationsDeps {
  tracker: StateTracker;
  getWindow: () => BrowserWindow | null;
  /** Read fresh on every transition so a settings change takes effect
   *  immediately without restart. Don't capture at install time. */
  getSettings: () => AppSettings;
  /** Latest meta lookup. Used for projectLabel and the latest assistant
   *  text body content. */
  getMeta: (sessionId: string) => SessionMeta | undefined;
  /** Latest message tail lookup. Used to fetch the most recent
   *  assistant-text for the "turn finished" body. Returns the full
   *  message array the tracker holds for the session, or undefined. */
  getMessages: (sessionId: string) => readonly Message[] | undefined;
}

/**
 * Subscribes to tracker state changes and fires native notifications
 * per the user's current mode. Returns an unsubscribe function for tests
 * and graceful shutdown.
 */
export function installNotifications(deps: NotificationsDeps): () => void {
  if (!Notification.isSupported()) {
    log.info('[notifications] Notification.isSupported() is false; skipping install');
    return () => { /* no-op */ };
  }

  // Track previous state-kind per session so we can detect specific
  // working → X transitions. The tracker payload doesn't include
  // previous state.
  const lastSeenKind = new Map<string, SessionState['kind']>();

  const unsubscribe = deps.tracker.addListener((sessionId, payload) => {
    const prevKind = lastSeenKind.get(sessionId);
    const nextKind = payload.state.kind;
    lastSeenKind.set(sessionId, nextKind);

    // Filter to state-kind transitions only. Freshness-tier transitions
    // (fresh → recent → stale) fire the listener but should not produce
    // notifications.
    //
    // When prevKind is undefined this is the first state observation for this
    // session. We deliberately skip it — the alternative would be notifying on
    // stale state that predates Helm starting (e.g. a session already blocked
    // when the app opened). Trade-off: a working → blocked transition that
    // happens to be the very first observation is missed; all subsequent
    // transitions for the same session work normally.
    if (prevKind === undefined || prevKind === nextKind) return;

    // Read settings fresh — supports mid-flight mode toggles.
    const { mode } = deps.getSettings().notifications;
    if (mode === 'off') return;

    const meta = deps.getMeta(sessionId);
    if (!meta) return;

    if (prevKind === 'working' && nextKind === 'blocked') {
      fireBlockedNotification(meta, payload, deps.getWindow);
      return;
    }
    if (prevKind === 'working' && nextKind === 'awaiting-user' && mode === 'blocked-and-finished') {
      const messages = deps.getMessages(sessionId);
      fireFinishedNotification(meta, messages, deps.getWindow);
      return;
    }
  });

  return unsubscribe;
}

function fireBlockedNotification(
  meta: SessionMeta,
  payload: TrackerPayload,
  getWindow: () => BrowserWindow | null,
): void {
  if (payload.state.kind !== 'blocked') return;
  const reason = payload.state.reason;
  const title = `${meta.projectLabel} needs you`;
  const body =
    reason.type === 'permission' ? `Permission required: ${reason.tool}` :
    reason.type === 'question'   ? 'Claude is asking a question' :
    /* plan-review */              'Plan ready for review';
  showAndRoute(title, body, meta.id, getWindow);
}

function fireFinishedNotification(
  meta: SessionMeta,
  messages: readonly Message[] | undefined,
  getWindow: () => BrowserWindow | null,
): void {
  const lastText = findLatestAssistantText(messages ?? []);
  const body = lastText && lastText.length > 0
    ? truncate(lastText, 80)
    : 'Claude is ready for your next prompt';
  const title = `${meta.projectLabel} — turn finished`;
  showAndRoute(title, body, meta.id, getWindow);
}

function findLatestAssistantText(messages: readonly Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.kind === 'assistant-text' && typeof m.text === 'string') {
      return m.text.trim();
    }
  }
  return null;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function showAndRoute(
  title: string,
  body: string,
  sessionId: string,
  getWindow: () => BrowserWindow | null,
): void {
  try {
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      // Bring the window forward and tell the renderer to route to this
      // session's detail view. The renderer handles the actual navigation.
      if (win.isMinimized()) win.restore();
      win.focus();
      win.webContents.send('notifications:focus-session', { sessionId });
    });
    notification.show();
  } catch (err) {
    log.warn('[notifications] failed to fire', err);
  }
}
