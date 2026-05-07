/**
 * OS notification permission detection and settings deep-link.
 *
 * macOS: uses systemPreferences.getNotificationSettings() which returns
 * { authorizationStatus } — 0=notDetermined, 1=denied, 2=authorized,
 * 3=provisional, 4=ephemeral. We map anything other than 2/3/4 to
 * 'denied' or 'unknown'.
 *
 * Windows: Notification.isSupported() is the only reliable gate.
 * Windows doesn't have a per-app permission prompt the way macOS does;
 * if isSupported() is true, notifications will work.
 *
 * Linux: libnotify presence is the only check. If isSupported() is true,
 * they work.
 */

import { shell, systemPreferences, Notification } from 'electron';
import log from 'electron-log';

export type PermissionStatus = 'granted' | 'denied' | 'unknown';

export async function getNotificationPermissionStatus(): Promise<PermissionStatus> {
  if (!Notification.isSupported()) return 'denied';

  if (process.platform === 'darwin') {
    try {
      // getNotificationSettings is available in newer Electron builds on macOS.
      // authorizationStatus values: 0=notDetermined, 1=denied,
      // 2=authorized, 3=provisional, 4=ephemeral.
      // Cast through unknown because older @types/electron doesn't declare it.
      const sp = systemPreferences as unknown as { getNotificationSettings?: () => { authorizationStatus: number } };
      const settings = sp.getNotificationSettings?.();
      if (settings) {
        const { authorizationStatus } = settings;
        if (authorizationStatus === 2 || authorizationStatus === 3 || authorizationStatus === 4) return 'granted';
        if (authorizationStatus === 1) return 'denied';
        // 0 = notDetermined — show the banner so the user knows to allow it.
        return 'unknown';
      }
    } catch (err) {
      log.warn('[notifications/permission] getNotificationSettings failed', err);
    }
    return 'unknown';
  }

  // Windows / Linux: isSupported() is sufficient.
  return 'granted';
}

export function openSystemNotificationSettings(): void {
  let url: string;
  if (process.platform === 'darwin') {
    url = 'x-apple.systempreferences:com.apple.preference.notifications';
  } else if (process.platform === 'win32') {
    url = 'ms-settings:notifications';
  } else {
    // No universal deep-link on Linux. Open the Helm docs page instead.
    url = 'https://github.com/helm-app/helm/blob/main/docs/notifications.md';
  }
  void shell.openExternal(url);
}
