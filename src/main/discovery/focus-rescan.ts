/**
 * Focus-driven re-discovery (PRD §6.1.5, audit #6).
 *
 * When the user brings Helm to the front, we run discovery again and push
 * `discovery:changed` to the renderer if anything is different. The
 * renderer already listens for that event and reloads the session list.
 *
 * Throttled to one rescan per FOCUS_THROTTLE_MS — repeated Cmd-Tab cycles
 * within a few seconds shouldn't hammer the filesystem. Manual refresh
 * (the button in the sessions header) bypasses this throttle by calling
 * `discovery:rescan` directly via IPC.
 */

import type { BrowserWindow } from 'electron';
import log from 'electron-log';
import { runDiscovery } from '.';
import { getAdapter } from '../adapters';
import { settingsStore } from '../store/settings';

const FOCUS_THROTTLE_MS = 5_000;

let lastRunAt = 0;
let lastSessionIdSet: Set<string> | null = null;
let inFlight: Promise<void> | null = null;

export async function runDiscoveryAndPushIfChanged(
  getWindow: () => BrowserWindow | null,
): Promise<void> {
  // Coalesce concurrent calls: if a rescan is already running, return its
  // promise instead of starting a second one.
  if (inFlight) return inFlight;

  const now = Date.now();
  if (now - lastRunAt < FOCUS_THROTTLE_MS) return;
  lastRunAt = now;

  inFlight = (async () => {
    try {
      const settings = settingsStore.get();
      const discoveries = await runDiscovery(settings.enabledAdapters);

      // Build the fresh set of session ids the same way sessions:list does.
      // Any difference (added or removed) triggers a discovery:changed push.
      const freshIds = new Set<string>();
      for (const d of discoveries) {
        if (!d.result.ok) continue;
        const adapter = getAdapter(d.adapter);
        if (!adapter) continue;
        try {
          const sessions = await adapter.listSessions(d.path);
          for (const s of sessions) freshIds.add(s.id);
        } catch (err) {
          log.warn(`[focus-rescan] ${d.adapter} listSessions failed`, err);
        }
      }

      const changed =
        lastSessionIdSet === null
        || lastSessionIdSet.size !== freshIds.size
        || [...freshIds].some(id => !lastSessionIdSet!.has(id));

      lastSessionIdSet = freshIds;
      if (!changed) return;

      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('discovery:changed', { sessionsAddedOrChanged: freshIds.size });
      }
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Test-only — reset the throttle and cached snapshot between runs. */
export function __resetFocusRescanForTests(): void {
  lastRunAt = 0;
  lastSessionIdSet = null;
  inFlight = null;
}
