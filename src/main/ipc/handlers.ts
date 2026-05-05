/**
 * IPC handlers.
 *
 * Each method on IpcRequest gets exactly one handler registered here.
 * Heavy lifting (state derivation, file parsing) lives in dedicated
 * modules — this file is just the entry point and the glue between
 * adapters, the StateTracker, and the renderer over IPC.
 */

import { ipcMain, type BrowserWindow } from 'electron';
import log from 'electron-log';
import chokidar, { type FSWatcher } from 'chokidar';
import { adapters, getAdapter } from '../adapters';
import { runDiscovery } from '../discovery';
import { settingsStore } from '../store/settings';
import { readTailMessages, extractTailMeta } from '../adapters/claude-code/lister';
import { StateTracker } from '../state/tracker';
import { classifyModel } from '../../shared/model-classification';
import { assertObject, assertSessionId } from './validate';
import type { SessionMeta, Message, SessionState } from '../../shared/types';

type GetWindow = () => BrowserWindow | null;

const activeWatchers = new Map<string, () => void>();
const sessionIndex = new Map<string, SessionMeta>();
const tracker = new StateTracker();

// Lookup accessors for downstream subscribers (e.g. notifications) that
// need to read the latest meta or the tracker's cached message tail
// without taking a hard dep on the IPC handler internals.
export function getSessionMeta(id: string): SessionMeta | undefined {
  return sessionIndex.get(id);
}
export function getTracker(): StateTracker {
  return tracker;
}

let metaWatcher: FSWatcher | null = null;

function sendMetaChanged(getWindow: GetWindow, meta: SessionMeta): void {
  const win = getWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send('sessions:meta-changed', { meta });
  }
}

function applyTrackerPayload(
  sessionId: string,
  payload: { state: SessionState; lastUserInputAt: number | null },
  getWindow: GetWindow,
): void {
  const meta = sessionIndex.get(sessionId);
  if (!meta) return;
  const updated: SessionMeta = {
    ...meta,
    state: payload.state,
    lastUserInputAt: payload.lastUserInputAt !== null
      ? new Date(payload.lastUserInputAt).toISOString()
      : null,
  };
  sessionIndex.set(sessionId, updated);
  sendMetaChanged(getWindow, updated);
}

/** Re-seed the tracker from the file's tail and return the freshly computed payload. */
function seedTrackerFromTail(meta: SessionMeta, lastEventAt: number): { state: SessionState; lastUserInputAt: number | null } {
  const tail = readTailMessages(meta.filePath);
  return tracker.seed(meta.id, {
    messages: tail,
    lastEventAt,
    permissionMode: meta.permissionMode,
    lastUserInputAt: meta.lastUserInputAt ? Date.parse(meta.lastUserInputAt) : null,
  });
}

function startMetaWatcher(sessions: SessionMeta[], getWindow: GetWindow): void {
  metaWatcher?.close();
  metaWatcher = null;

  const filePaths = sessions.map(s => s.filePath);
  if (filePaths.length === 0) return;

  const fileToId = new Map<string, string>(sessions.map(s => [s.filePath, s.id]));

  metaWatcher = chokidar.watch(filePaths, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
  });

  metaWatcher.on('change', (filePath: string) => {
    const sessionId = fileToId.get(filePath);
    if (!sessionId) return;

    // Skip re-seed for sessions with an active per-session watcher: that
    // watcher's tracker.ingest calls are authoritative and incremental.
    // Re-seeding here would truncate message history outside the 64KB tail
    // and could briefly mis-classify a working session as awaiting-user.
    //
    // When the user closes the detail view (sessions:unwatch fires), we do
    // NOT eagerly re-seed — the next file write will trigger this handler
    // normally and refresh state. If no write comes, no refresh is needed:
    // nothing has changed.
    if (activeWatchers.has(sessionId)) return;

    const meta = sessionIndex.get(sessionId);
    if (!meta) return;

    // Re-seed the tracker from the new tail and apply the resulting state to
    // the meta in the same push — this is what makes "WORKING" appear instantly
    // when the user sends a prompt, even for non-live-watched grid cards.
    const lastActivityAt = new Date().toISOString();
    const tail = readTailMessages(filePath);
    const tailMeta = extractTailMeta(tail);
    const seeded = tracker.seed(sessionId, {
      messages: tail,
      lastEventAt: Date.parse(lastActivityAt),
      permissionMode: tailMeta.permissionMode ?? meta.permissionMode,
      lastUserInputAt: tailMeta.lastUserInputAt
        ? Date.parse(tailMeta.lastUserInputAt)
        : (meta.lastUserInputAt ? Date.parse(meta.lastUserInputAt) : null),
    });

    // Latest-wins for the freshable fields. We never downgrade non-null
    // values to null, because the tail might not include the original
    // first-prompt that carried the model/permissionMode if the file is
    // larger than the 64KB tail window.
    const nextModel = tailMeta.model ?? meta.model;
    const nextPermissionMode = tailMeta.permissionMode ?? meta.permissionMode;
    const { modelClass: nextModelClass, modelProvider: nextModelProvider } = classifyModel(nextModel);

    // For totals: the tail gives us a *partial* sum. Once the user has
    // opened the session, sessions:get has populated full totals on the
    // cached meta — we don't want to clobber those with a smaller tail
    // count. Take the max so totals only go up.
    const nextMessageCount = Math.max(meta.messageCount, tailMeta.messageCount);
    const nextTotalTokens  = Math.max(meta.totalTokens, tailMeta.tokens);
    const nextTotalCostUsd = Math.max(meta.totalCostUsd, tailMeta.costUsd);

    const updated: SessionMeta = {
      ...meta,
      lastActivityAt,
      state: seeded.state,
      lastUserInputAt: seeded.lastUserInputAt !== null
        ? new Date(seeded.lastUserInputAt).toISOString()
        : meta.lastUserInputAt,
      model: nextModel,
      modelClass: nextModelClass,
      modelProvider: nextModelProvider,
      permissionMode: nextPermissionMode,
      messageCount: nextMessageCount,
      totalTokens: nextTotalTokens,
      totalCostUsd: nextTotalCostUsd,
    };
    sessionIndex.set(sessionId, updated);
    sendMetaChanged(getWindow, updated);
  });

  metaWatcher.on('error', (err: unknown) => {
    log.warn('[meta-watcher] error', err);
  });
}

export function registerIpcHandlers(getWindow: GetWindow): void {
  // Wire the tracker so any state change pushes a fresh SessionMeta to the renderer.
  // addListener returns an unsubscribe; we hold it to allow future teardown
  // (currently only invoked at process exit via Electron's lifecycle).
  tracker.addListener((sessionId, payload) => applyTrackerPayload(sessionId, payload, getWindow));

  ipcMain.handle('discovery:rescan', async () => {
    const settings = settingsStore.get();
    return runDiscovery(settings.enabledAdapters);
  });

  ipcMain.handle('sessions:list', async () => {
    const settings = settingsStore.get();
    const discoveries = await runDiscovery(settings.enabledAdapters);
    const all: SessionMeta[] = [];

    for (const d of discoveries) {
      if (!d.result.ok) continue;
      const adapter = getAdapter(d.adapter);
      if (!adapter) continue;
      try {
        const sessions = await adapter.listSessions(d.path);
        for (const s of sessions) {
          sessionIndex.set(s.id, s);
          seedTrackerFromTail(s, Date.parse(s.lastActivityAt) || Date.now());
        }
        all.push(...sessions);
      } catch (err) {
        log.error(`[sessions:list] ${d.adapter} at ${d.path}`, err);
      }
    }

    all.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

    // Eviction (audit #10). Sessions that no longer appear in fresh
    // discovery (file deleted on disk, project removed) must be cleared
    // from sessionIndex, the tracker, and any active live watcher —
    // otherwise long-running Helm processes accumulate per-session
    // memory and 1s tracker ticks for sessions that no longer exist.
    const freshIds = new Set(all.map(s => s.id));
    for (const cachedId of [...sessionIndex.keys()]) {
      if (!freshIds.has(cachedId)) {
        sessionIndex.delete(cachedId);
        tracker.forget(cachedId);
        const stop = activeWatchers.get(cachedId);
        if (stop) { stop(); activeWatchers.delete(cachedId); }
      }
    }

    startMetaWatcher(all, getWindow);

    return all;
  });

  ipcMain.handle('sessions:get', async (_e, payload: unknown) => {
    const obj = assertObject(payload, 'sessions:get payload');
    const id = assertSessionId(obj['id']);
    const meta = sessionIndex.get(id);
    if (!meta) throw new Error(`Unknown session: ${id}`);
    const adapter = getAdapter(meta.adapter);
    if (!adapter) throw new Error(`Unknown adapter: ${meta.adapter}`);

    const messages: Message[] = [];
    for await (const m of adapter.parseSession(meta.filePath)) {
      messages.push(m);
    }

    // Compute accurate stats from the full message list and return an
    // enriched meta so the detail view shows real numbers immediately.
    //
    // For `model`: latest assistant-text wins. The original first-write-wins
    // logic (the `!model` guard) misrepresented sessions where the user
    // swapped models mid-conversation — the stats strip would keep showing
    // the first model used even after a switch.
    let totalTokens = 0;
    let totalCostUsd = 0;
    let messageCount = 0;
    let model = meta.model;
    for (const m of messages) {
      if (m.kind === 'assistant-usage') totalTokens += m.inputTokens + m.outputTokens;
      if (m.kind === 'session-result') totalCostUsd = m.costUsd;
      if (m.kind === 'user-prompt' || m.kind === 'assistant-text') messageCount++;
      if (m.kind === 'assistant-text' && m.model) model = m.model;
    }
    // Re-seed the tracker with the full message list — gives the most accurate state
    // and lets the tracker sniff permissionMode + lastUserInputAt from real events.
    const seeded = tracker.seed(id, {
      messages,
      lastEventAt: Date.parse(meta.lastActivityAt) || Date.now(),
      permissionMode: meta.permissionMode,
      lastUserInputAt: meta.lastUserInputAt ? Date.parse(meta.lastUserInputAt) : null,
    });
    const enrichedMeta: SessionMeta = {
      ...meta,
      totalTokens,
      totalCostUsd,
      messageCount,
      model,
      state: seeded.state,
      lastUserInputAt: seeded.lastUserInputAt !== null
        ? new Date(seeded.lastUserInputAt).toISOString()
        : null,
    };
    sessionIndex.set(id, enrichedMeta);

    return { meta: enrichedMeta, messages };
  });

  ipcMain.handle('sessions:watch', async (_e, payload: unknown) => {
    const obj = assertObject(payload, 'sessions:watch payload');
    const id = assertSessionId(obj['id']);
    if (activeWatchers.has(id)) return { ok: true as const };

    const meta = sessionIndex.get(id);
    if (!meta) throw new Error(`Unknown session: ${id}`);
    const adapter = getAdapter(meta.adapter);
    if (!adapter) throw new Error(`Unknown adapter: ${meta.adapter}`);

    const stop = adapter.watchSession(meta.filePath, (message) => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      win.webContents.send('sessions:event', { sessionId: id, message });
      // Feed the tracker so the state recomputes for this session in real time.
      tracker.ingest(id, message);
    });
    activeWatchers.set(id, stop);
    return { ok: true as const };
  });

  ipcMain.handle('sessions:unwatch', async (_e, payload: unknown) => {
    const obj = assertObject(payload, 'sessions:unwatch payload');
    const id = assertSessionId(obj['id']);
    const stop = activeWatchers.get(id);
    if (stop) {
      stop();
      activeWatchers.delete(id);
    }
    return { ok: true as const };
  });

  ipcMain.handle('settings:get', async () => settingsStore.get());

  ipcMain.handle('settings:set', async (_e, patch: unknown) => {
    // settingsStore.update is the validation boundary: it whitelists keys,
    // validates types, and rejects non-object payloads. No destructure here.
    return settingsStore.update(patch);
  });

  ipcMain.handle('adapters:list', async () => {
    const settings = settingsStore.get();
    return adapters.map(a => ({
      id: a.id,
      displayName: a.displayName,
      enabled: settings.enabledAdapters.includes(a.id),
    }));
  });
}
