import { create } from 'zustand';
import type { AppSettings } from '@shared/ipc-contract';

interface SettingsState {
  settings: AppSettings | null;
  load: () => Promise<void>;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: null,

  async load() {
    if (!window.helm) return;
    const settings = await window.helm.invoke('settings:get');
    set({ settings });
  },

  async update(patch) {
    if (!window.helm) return;
    const next = await window.helm.invoke('settings:set', patch as unknown);
    set({ settings: next });
  },
}));
