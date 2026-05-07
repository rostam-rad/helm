/**
 * The full IPC surface, typed.
 *
 * Pattern: `IpcRequest` is a map from channel name to {req, res} types.
 * `IpcEvent` is a map for push-style events (main -> renderer).
 *
 * The actual `ipcRenderer.invoke` and `ipcMain.handle` are wrapped in a
 * tiny typed helper (see src/main/ipc and src/renderer/ipc) so we never
 * write a stringly-typed `invoke('sessions:list', ...)` anywhere.
 */

import type { SessionMeta, Message, AdapterId, ValidationResult } from './types';

// Request/response — renderer calls main, awaits a reply.
export interface IpcRequest {
  'discovery:rescan': { req: void; res: { adapter: AdapterId; paths: string[]; result: ValidationResult }[] };
  'sessions:list':    { req: void; res: SessionMeta[] };
  'sessions:get':     { req: { id: string };  res: { meta: SessionMeta; messages: Message[] } };
  'sessions:watch':   { req: { id: string };  res: { ok: true } };
  'sessions:unwatch': { req: { id: string };  res: { ok: true } };
  'settings:get':     { req: void; res: AppSettings };
  // req is `unknown` because validation lives in the main process
  // (see src/main/store/settings.ts). The renderer can still pass a
  // Partial<AppSettings>-shaped object — it just gets validated on
  // arrival rather than typechecked away from the boundary.
  'settings:set':     { req: unknown; res: AppSettings };
  'adapters:list':    { req: void; res: { id: AdapterId; displayName: string; enabled: boolean }[] };
  'notifications:permission-status': { req: void; res: PermissionStatus };
  'notifications:open-system-settings': { req: void; res: void };
  'dialog:open-directory': { req: void; res: string | null };
  'discovery:search-filesystem': { req: void; res: SpotlightResult[] };
  'discovery:abort-search': { req: void; res: void };
}

export type PermissionStatus = 'granted' | 'denied' | 'unknown';

export interface SpotlightResult {
  path: string;
  adapter: AdapterId;
  confidence: 'high' | 'low';
}

// Push events — main pushes to renderer, no reply.
export interface IpcEvent {
  'sessions:event':       { sessionId: string; message: Message };
  'sessions:meta-changed': { meta: SessionMeta };
  'discovery:changed':    { sessionsAddedOrChanged: number };
  /** User clicked a notification — focus the main window and route the
   *  renderer to the named session's detail view. */
  'notifications:focus-session': { sessionId: string };
}

export type NotificationMode = 'off' | 'blocked-only' | 'blocked-and-finished';

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  enabledAdapters: AdapterId[];
  customPaths: { adapter: AdapterId; path: string }[];
  notifications: {
    /**
     * Single radio choice (rather than independent booleans for blocked
     * vs finished). 'blocked-only' is the default high-signal mode.
     * See src/main/notifications/index.ts for the full rationale.
     */
    mode: NotificationMode;
    /** Check GitHub Releases for updates on launch and every 4 hours. */
    checkForUpdates: boolean;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  enabledAdapters: ['claude-code', 'cline'],
  customPaths: [],
  notifications: { mode: 'blocked-only', checkForUpdates: true },
};
