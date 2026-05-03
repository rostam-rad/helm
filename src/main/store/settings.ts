/**
 * Settings store. Wraps electron-store with typed access and merging.
 */

import Store from 'electron-store';
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/ipc-contract';

const store = new Store<{ settings: AppSettings }>({
  defaults: { settings: DEFAULT_SETTINGS },
});

export const settingsStore = {
  get(): AppSettings {
    return store.get('settings');
  },
  update(patch: Partial<AppSettings>): AppSettings {
    const next = { ...store.get('settings'), ...patch };
    store.set('settings', next);
    return next;
  },
};
