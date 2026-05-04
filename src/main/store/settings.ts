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
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/ipc-contract';

const store = new Store<{ settings: AppSettings }>({
  defaults: { settings: DEFAULT_SETTINGS },
});

const ALLOWED_KEYS = new Set<keyof AppSettings>([
  'theme', 'enabledAdapters', 'customPaths', 'notifications',
]);
const VALID_THEMES = new Set<AppSettings['theme']>(['light', 'dark', 'system']);

export const settingsStore = {
  get(): AppSettings {
    return store.get('settings');
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
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            const n = value as Record<string, unknown>;
            next.notifications = {
              onIdle: typeof n['onIdle'] === 'boolean' ? n['onIdle'] : current.notifications.onIdle,
              onError: typeof n['onError'] === 'boolean' ? n['onError'] : current.notifications.onError,
              onComplete: typeof n['onComplete'] === 'boolean' ? n['onComplete'] : current.notifications.onComplete,
              idleThresholdSeconds:
                typeof n['idleThresholdSeconds'] === 'number' && n['idleThresholdSeconds'] >= 0
                  ? n['idleThresholdSeconds']
                  : current.notifications.idleThresholdSeconds,
            };
          }
          break;
        }
      }
    }

    store.set('settings', next);
    return next;
  },
};
