/**
 * Session lister for Cline.
 *
 * Enumerates tasks/<task-id>/ directories under the Cline globalStorage
 * root. Each task directory contains:
 *   - task_metadata.json  — id, ts (epoch ms), task text, model, cost
 *   - api_conversation_history.json — full conversation
 *   - ui_messages.json   — UI-layer events (used for first-message label)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { SessionMeta } from '../../../shared/types';
import { classifyModel } from '../../../shared/model-classification';
import { computeState } from '../../state/computeState';
import { parseClineHistory } from './parser';

interface TaskMetadata {
  id?: string;
  ts?: number;
  task?: string;
  dirAbsolutePath?: string;
  api_provider?: string;
  model_id?: string;
  totalCost?: number;
}

export async function listClineSessions(rootPath: string): Promise<SessionMeta[]> {
  const tasksDir = path.join(rootPath, 'tasks');
  let taskDirs: string[];
  try {
    const entries = await fs.readdir(tasksDir, { withFileTypes: true });
    taskDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }

  const sessions: SessionMeta[] = [];

  await Promise.all(taskDirs.map(async (taskId) => {
    const taskPath = path.join(tasksDir, taskId);
    const metaPath = path.join(taskPath, 'task_metadata.json');
    const historyPath = path.join(taskPath, 'api_conversation_history.json');

    let meta: TaskMetadata = {};
    try {
      meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as TaskMetadata;
    } catch { /* metadata optional */ }

    let messages: ReturnType<typeof parseClineHistory> = [];
    try {
      const raw = JSON.parse(await fs.readFile(historyPath, 'utf-8'));
      messages = parseClineHistory(raw);
    } catch { /* skip unreadable */ }

    if (messages.length === 0 && !meta.task) return;

    const startedAt = meta.ts ? new Date(meta.ts).toISOString() : new Date().toISOString();
    const lastActivityAt = startedAt;
    const cwd = meta.dirAbsolutePath ?? taskPath;
    const projectLabel = path.basename(cwd);
    const model = meta.model_id ?? null;
    const { modelClass, modelProvider } = classifyModel(model);

    const firstUserMsg = messages.find(m => m.kind === 'user-prompt');
    const firstUserMessage = firstUserMsg && firstUserMsg.kind === 'user-prompt'
      ? firstUserMsg.text.slice(0, 120)
      : (meta.task?.slice(0, 120) ?? null);

    const totalTokens = messages.reduce((n, m) =>
      m.kind === 'assistant-usage' ? n + m.inputTokens + m.outputTokens : n, 0);
    const messageCount = messages.filter(
      m => m.kind === 'user-prompt' || m.kind === 'assistant-text',
    ).length;

    const state = computeState({
      messages,
      lastEventAt: meta.ts ?? Date.now(),
      permissionMode: null,
      now: Date.now(),
    });

    sessions.push({
      id: `cline:${taskId}`,
      adapter: 'cline',
      cwd,
      projectLabel,
      filePath: historyPath,
      gitBranch: null,
      startedAt,
      lastActivityAt,
      lastUserInputAt: null,
      state,
      isSidechain: false,
      parentSessionId: null,
      messageCount,
      totalTokens,
      totalCostUsd: meta.totalCost ?? 0,
      model,
      modelClass,
      modelProvider,
      permissionMode: null,
      entrypoint: 'cline',
      agentVersion: null,
      firstUserMessage,
    });
  }));

  return sessions.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}
