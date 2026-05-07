import { create } from 'zustand';
import type { PermissionStatus } from '@shared/ipc-contract';

interface NotificationPermissionState {
  status: PermissionStatus | null;
  dismissed: boolean;
  load: () => Promise<void>;
  dismiss: () => void;
}

export const useNotificationPermissionStore = create<NotificationPermissionState>((set) => ({
  status: null,
  dismissed: false,

  async load() {
    if (!window.helm) return;
    const status = await window.helm.invoke('notifications:permission-status');
    set({ status });
  },

  dismiss() {
    set({ dismissed: true });
  },
}));
