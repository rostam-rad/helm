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
import type { SessionMeta, Message, SessionState } from '../../shared/types';

type GetWindow = () => BrowserWindow | null;

const activeWatchers = new Map<string, () => void>();
const sessionIndex = new Map<string, SessionMeta>();
const tracker = new StateTracker();

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
  tracker.setListener((sessionId, payload) => applyTrackerPayload(sessionId, payload, getWindow));

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
    startMetaWatcher(all, getWindow);

    return all;
  });

  ipcMain.handle('sessions:get', async (_e, { id }: { id: string }) => {
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
    let totalTokens = 0;
    let totalCostUsd = 0;
    let messageCount = 0;
    let model = meta.model;
    for (const m of messages) {
      if (m.kind === 'assistant-usage') totalTokens += m.inputTokens + m.outputTokens;
      if (m.kind === 'session-result') totalCostUsd = m.costUsd;
      if (m.kind === 'user-prompt' || m.kind === 'assistant-text') messageCount++;
      if (m.kind === 'assistant-text' && m.model && !model) model = m.model;
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

  ipcMain.handle('sessions:watch', async (_e, { id }: { id: string }) => {
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

  ipcMain.handle('sessions:unwatch', async (_e, { id }: { id: string }) => {
    const stop = activeWatchers.get(id);
    if (stop) {
      stop();
      activeWatchers.delete(id);
    }
    return { ok: true as const };
  });

  ipcMain.handle('settings:get', async () => settingsStore.get());

  ipcMain.handle('settings:set', async (_e, patch) => {
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
