/**
 * Cline AgentAdapter implementation.
 *
 * Cline (saoudrizwan.claude-dev) is a VS Code extension that writes
 * conversation data to VS Code's globalStorage. This adapter discovers
 * those directories and surfaces tasks as Helm sessions.
 *
 * v0.3 scope:
 *   - Discovery + listing (project label, model, message count, cost)
 *   - Live tailing (watches api_conversation_history.json)
 *   - Read-mode timeline (user/assistant/tool-call as generic cards)
 *
 * v0.3 explicitly skips:
 *   - Tool-specific rendering (Cline has different tool names)
 *   - Permission/blocked detection (Cline's approval flow is different)
 *   - Sub-agent linking
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { AgentAdapter } from '../types';
import type { ValidationResult } from '../../../shared/types';
import { discoverClinePaths } from './discovery';
import { listClineSessions } from './lister';
import { parseClineHistory } from './parser';
import { watchClineSession } from './watcher';

export const clineAdapter: AgentAdapter = {
  id: 'cline',
  displayName: 'Cline',

  async discoverPaths(): Promise<string[]> {
    return discoverClinePaths();
  },

  async validatePath(p: string): Promise<ValidationResult> {
    try {
      const stat = await fs.stat(p);
      if (!stat.isDirectory()) return { ok: false, reason: 'unknown' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, reason: 'permission-denied' };
      return { ok: false, reason: 'not-found' };
    }

    const tasksDir = path.join(p, 'tasks');
    try {
      const stat = await fs.stat(tasksDir);
      if (!stat.isDirectory()) return { ok: false, reason: 'no-projects-dir' };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === 'EACCES' || code === 'EPERM') return { ok: false, reason: 'permission-denied' };
      return { ok: false, reason: 'no-projects-dir' };
    }

    const sessions = await listClineSessions(p);
    return { ok: true, sessionCount: sessions.length };
  },

  async listSessions(rootPath: string) {
    return listClineSessions(rootPath);
  },

  async *parseSession(filePath: string) {
    const raw = JSON.parse(await fs.readFile(filePath, 'utf-8'));
    for (const m of parseClineHistory(raw)) yield m;
  },

  watchSession(filePath: string, cb) {
    return watchClineSession(filePath, cb);
  },
};
