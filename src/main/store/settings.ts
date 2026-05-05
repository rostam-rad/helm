/**
 * Settings store. Wraps electron-store with typed access and merging.
 *
 * `update` is the trust boundary for renderer-supplied settings patches.
 * It accepts `unknown` and validates everything before persisting:
 *  - rejects non-object payloads outright (TypeError)
 *  - drops unknown keys silently (forward-compat with newer renderers)
 *  - validates each known key's value shape; invalid values are ignored
 *    and the existing setting is kept
 *  - never spreads the patch directly, so __proto__ / constructor /
 *    other prototype-pollution keys never reach the persisted object
 */

import Store from 'electron-store';
import log from 'electron-log';
import { DEFAULT_SETTINGS, type AppSettings, type NotificationMode } from '../../shared/ipc-contract';

const store = new Store<{ settings: AppSettings }>({
  defaults: { settings: DEFAULT_SETTINGS },
});

const ALLOWED_KEYS = new Set<keyof AppSettings>([
  'theme', 'enabledAdapters', 'customPaths', 'notifications',
]);
const VALID_THEMES = new Set<AppSettings['theme']>(['light', 'dark', 'system']);
const VALID_NOTIFICATION_MODES = new Set<NotificationMode>(['off', 'blocked-only', 'blocked-and-finished']);

/**
 * v0.1 → v0.2 migration for the notifications shape.
 *
 * v0.1 stored { onIdle, onError, onComplete, idleThresholdSeconds }, all
 * unwired (audit #7). We don't try to preserve user intent — there was
 * no real intent — and just default everyone to 'blocked-only'. Users
 * with a v0.2 shape already persisted are passed through.
 */
function migrateNotifications(persisted: unknown): { mode: NotificationMode } {
  if (
    persisted !== null
    && typeof persisted === 'object'
    && 'mode' in persisted
    && typeof (persisted as { mode: unknown }).mode === 'string'
    && VALID_NOTIFICATION_MODES.has((persisted as { mode: string }).mode as NotificationMode)
  ) {
    return { mode: (persisted as { mode: NotificationMode }).mode };
  }
  return { mode: 'blocked-only' };
}

let migrated = false;

export const settingsStore = {
  get(): AppSettings {
    const raw = store.get('settings');
    // Lazy one-shot migration on first read after launch. Runs against
    // the resolved electron-store, not at module top-level (which would
    // execute before the app's userData path is set).
    if (!migrated) {
      migrated = true;
      const beforeMode = (raw.notifications as unknown as { mode?: unknown })?.mode;
      const normalized: AppSettings = {
        ...raw,
        notifications: migrateNotifications(raw.notifications),
      };
      if (beforeMode !== normalized.notifications.mode) {
        log.debug('[settings] migrated notifications shape to v0.2', { mode: normalized.notifications.mode });
        store.set('settings', normalized);
      }
      return normalized;
    }
    return raw;
  },

  /** Test-only — reset the one-shot migration flag between runs. */
  __resetForTests(): void {
    migrated = false;
  },

  update(patch: unknown): AppSettings {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('settings patch must be an object');
    }
    const current = store.get('settings');
    const next: AppSettings = { ...current };

    // Iterate own enumerable string keys only via Object.entries — this
    // is what stops __proto__ from being walked. Even if the renderer
    // sent a __proto__ key, ALLOWED_KEYS doesn't include it so the
    // continue branch fires below.
    for (const [key, value] of Object.entries(patch)) {
      if (!ALLOWED_KEYS.has(key as keyof AppSettings)) continue;

      switch (key) {
        case 'theme': {
          if (typeof value === 'string' && VALID_THEMES.has(value as AppSettings['theme'])) {
            next.theme = value as AppSettings['theme'];
          }
          break;
        }
        case 'enabledAdapters': {
          if (Array.isArray(value) && value.every(v => typeof v === 'string')) {
            next.enabledAdapters = value as AppSettings['enabledAdapters'];
          }
          break;
        }
        case 'customPaths': {
          // Each entry must be {adapter: string, path: string}. We don't
          // validate path existence here — that happens at discovery time.
          // We do reject anything that isn't the right shape.
          if (Array.isArray(value)) {
            const sanitized = value.filter(
              (v): v is AppSettings['customPaths'][number] =>
                v !== null && typeof v === 'object'
                && typeof (v as { adapter?: unknown }).adapter === 'string'
                && typeof (v as { path?: unknown }).path === 'string',
            );
            next.customPaths = sanitized;
          }
          break;
        }
        case 'notifications': {
          // v0.2 shape: { mode: NotificationMode }. Unknown keys (incl.
          // v0.1's onIdle/onError/onComplete/idleThresholdSeconds) are
          // dropped silently — same forward-compat policy as the
          // top-level allowed-keys filter.
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const n = value as Record<string, unknown>;
            const mode = typeof n['mode'] === 'string' && VALID_NOTIFICATION_MODES.has(n['mode'] as NotificationMode)
              ? (n['mode'] as NotificationMode)
              : current.notifications.mode;
            next.notifications = { mode };
          }
          break;
        }
      }
    }

    store.set('settings', next);
    return next;
  },
};
