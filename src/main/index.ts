/**
 * Electron main process entry point.
 *
 * Keep this file small. App lifecycle and window creation live here;
 * everything else is delegated.
 */

import { app, BrowserWindow } from 'electron';
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
