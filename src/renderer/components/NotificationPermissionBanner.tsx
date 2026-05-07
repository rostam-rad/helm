import { useEffect } from 'react';
import { useNotificationPermissionStore } from '../stores/useNotificationPermissionStore';
import { useSettingsStore } from '../stores/useSettingsStore';

/**
 * Dismissable banner shown when notifications mode is non-'off' but the OS
 * appears to be blocking them. Re-checks on window focus so toggling system
 * settings and switching back clears it automatically.
 */
export function NotificationPermissionBanner() {
  const { status, dismissed, load, dismiss } = useNotificationPermissionStore();
  const notifMode = useSettingsStore(s => s.settings?.notifications.mode);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  // Don't show when mode is 'off' — user intentionally disabled notifications.
  if (notifMode === 'off') return null;
  if (dismissed || status === null || status === 'granted') return null;

  return (
    <div className="flex items-center gap-3 border-b border-rule bg-warn/10 px-4 py-2">
      <span className="shrink-0 text-warn">⚠</span>
      <p className="flex-1 font-mono text-2xs tracking-caps text-fg-2">
        Notifications are off in your system settings — Helm can&apos;t alert you when an agent needs attention.
      </p>
      <button
        onClick={() => void window.helm?.invoke('notifications:open-system-settings')}
        className="shrink-0 rounded border border-rule bg-bg-2 px-2 py-1 font-mono text-2xs tracking-caps text-fg hover:bg-bg transition-colors"
      >
        Open System Settings
      </button>
      <button
        onClick={dismiss}
        className="shrink-0 font-mono text-2xs tracking-caps text-fg-4 hover:text-fg transition-colors"
      >
        Dismiss
      </button>
    </div>
  );
}
