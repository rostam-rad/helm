/**
 * The Claude Code AgentAdapter implementation.
 *
 * This file does no heavy lifting itself — it just wires together the
 * specialised modules (discovery, lister, watcher, parser) to satisfy
 * the AgentAdapter interface.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream } from 'node:fs';
import type { AgentAdapter } from '../types';
import type { Message, ValidationResult, SessionMeta } from '../../../shared/types';
import { discoverClaudeCodePaths } from './discovery';
import { listClaudeCodeSessions } from './lister';
import { watchSessionFile } from './watcher';
import { parseLine } from './parser';

export const claudeCodeAdapter: AgentAdapter = {
  id: 'claude-code',
  displayName: 'Claude Code',

  async discoverPaths(): Promise<string[]> {
    return discoverClaudeCodePaths();
  },

  async validatePath(p: string): Promise<ValidationResult> {
    try {
      const stat = await fs.stat(p);
      if (!stat.isDirectory()) return { ok: false, reason: 'Not a directory' };
    } catch {
      return { ok: false, reason: 'Path does not exist' };
    }

    const projectsDir = path.join(p, 'projects');
    try {
      const stat = await fs.stat(projectsDir);
      if (!stat.isDirectory()) return { ok: false, reason: 'No projects/ subdirectory' };
    } catch {
      return { ok: false, reason: 'No projects/ subdirectory' };
    }

    // Count sessions cheaply.
    const sessions = await listClaudeCodeSessions(p);
    return { ok: true, sessionCount: sessions.length };
  },

  async listSessions(rootPath: string): Promise<SessionMeta[]> {
    return listClaudeCodeSessions(rootPath);
  },

  async *parseSession(filePath: string): AsyncIterable<Message> {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      for (const msg of parseLine(line)) yield msg;
    }
  },

  watchSession(filePath: string, cb: (m: Message) => void): () => void {
    return watchSessionFile(filePath, cb);
  },
};
