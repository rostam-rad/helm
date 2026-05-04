/**
 * Electron main process entry point.
 *
 * Keep this file small. App lifecycle and window creation live here;
 * everything else is delegated.
 */

import { app, BrowserWindow, shell } from 'electron';
import * as path from 'node:path';
import log from 'electron-log';
import { registerIpcHandlers } from './ipc/handlers';

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

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  registerIpcHandlers(() => mainWindow);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
