/**
 * Electron main process entry point.
 *
 * Keep this file small. App lifecycle and window creation live here;
 * everything else is delegated.
 */

import { app, BrowserWindow, shell } from 'electron';
import * as path from 'node:path';
import log from 'electron-log';
import { autoUpdater } from 'electron-updater';
import { registerIpcHandlers, getSessionMeta, getTracker } from './ipc/handlers';
import { runDiscoveryAndPushIfChanged } from './discovery/focus-rescan';
import { installNotifications } from './notifications';
import { settingsStore } from './store/settings';

log.transports.file.level = 'info';
log.transports.console.level = 'debug';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    // Industry-standard desktop minimums — fits half-screen splits on a
    // 1024-wide laptop and stacks next to a terminal. Session rail (280px) is
    // collapsible via the ◂ toggle, so 480px still gives a usable detail view.
    minWidth: 480,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Navigation guards (Electron security checklist).
  //
  // Two handlers are required because they cover different attack vectors:
  //
  //  - setWindowOpenHandler: intercepts window.open(), <a target="_blank">,
  //    and any other request to spawn a NEW BrowserWindow. Without this,
  //    such a window would inherit our preload (and thus window.helm), so
  //    arbitrary remote content could speak our IPC. Always deny; route
  //    legitimate http(s) links to the user's default browser instead.
  //
  //  - will-navigate: intercepts in-place navigation of the EXISTING
  //    window (e.g. window.location = '...'). Without this, a renderer
  //    compromise could repaint the entire window into a remote phishing
  //    page hosted by the attacker. Allow only the dev-server URL and
  //    file:// (the bundled renderer); deny everything else.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isDev = url.startsWith('http://localhost:5173');
    const isBundled = url.startsWith('file://');
    if (!isDev && !isBundled) {
      event.preventDefault();
    }
  });

  if (process.env['NODE_ENV'] === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  // Focus-driven re-discovery (PRD §6.1.5, audit #6). When the user comes
  // back to Helm, re-scan and push discovery:changed if anything moved.
  // The helper throttles to one rescan per 5s so rapid Cmd-Tab cycles
  // don't hammer the filesystem.
  mainWindow.on('focus', () => {
    void runDiscoveryAndPushIfChanged(() => mainWindow);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// Windows: notifications need an explicit App User Model ID to display
// the correct app name and persist in Action Center. Match the appId in
// package.json. Harmless on macOS / Linux.
app.setAppUserModelId('dev.helm.app');

app.whenReady().then(() => {
  registerIpcHandlers(() => mainWindow);

  installNotifications({
    tracker: getTracker(),
    getWindow: () => mainWindow,
    getSettings: () => settingsStore.get(),
    getMeta: getSessionMeta,
    getMessages: (id) => getTracker().getMessages(id),
  });

  // Auto-updater (v0.3). Checks GitHub Releases on launch and every 4h.
  // Skipped in dev mode and when the user has opted out. Errors are logged
  // but never crash the app — update delivery is best-effort.
  // Note: v0.3 ships unsigned; Gatekeeper/SmartScreen will flag the update
  // binary until code signing lands in v0.4.
  if (app.isPackaged) {
    autoUpdater.logger = log;
    const checkForUpdates = () => {
      if (!settingsStore.get().notifications.checkForUpdates) return;
      try { autoUpdater.checkForUpdatesAndNotify(); } catch (err) {
        log.warn('[updater] check failed', err);
      }
    };
    checkForUpdates();
    setInterval(checkForUpdates, 4 * 60 * 60 * 1000).unref();
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
