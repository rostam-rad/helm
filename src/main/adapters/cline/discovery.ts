/**
 * Discovery for Cline (saoudrizwan.claude-dev) data directories.
 *
 * Cline stores task data in VS Code's globalStorage. We probe the standard
 * VS Code, Cursor, VSCodium, and Code-Insiders paths on each platform.
 */

import * as path from 'node:path';
import * as os from 'node:os';

const EXTENSION_ID = 'saoudrizwan.claude-dev';

function globalStorageCandidates(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  if (process.platform === 'darwin') {
    const base = path.join(home, 'Library', 'Application Support');
    for (const app of ['Code', 'Cursor', 'VSCodium', 'Code - Insiders']) {
      candidates.push(path.join(base, app, 'User', 'globalStorage', EXTENSION_ID));
    }
  } else if (process.platform === 'win32') {
    const appData = process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming');
    for (const app of ['Code', 'Cursor', 'VSCodium', 'Code - Insiders']) {
      candidates.push(path.join(appData, app, 'User', 'globalStorage', EXTENSION_ID));
    }
  } else {
    // Linux
    const configHome = process.env['XDG_CONFIG_HOME'] ?? path.join(home, '.config');
    for (const app of ['Code', 'Cursor', 'VSCodium', 'Code - Insiders']) {
      candidates.push(path.join(configHome, app, 'User', 'globalStorage', EXTENSION_ID));
    }
  }

  return candidates;
}

export function discoverClinePaths(): string[] {
  return globalStorageCandidates();
}
