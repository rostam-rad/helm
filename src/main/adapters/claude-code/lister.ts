/**
 * Session lister for Claude Code.
 *
 * Given a path like `~/.claude/`, produce SessionMeta records for every
 * `.jsonl` file under `projects/`. This is the cheap path — we read just
 * enough of each file to populate metadata (first user message, project
 * name, model, totals) and the recent tail to feed the initial state
 * computation.
 *
 * The expensive path (full message timeline) lives in parser.ts and is
 * only invoked when a session is actually opened.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { createReadStream, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import type { Message, SessionMeta } from '../../../shared/types';
import { parseLine } from './parser';
import { classifyModel } from '../../../shared/model-classification';
import { computeState } from '../../state/computeState';

/** Read the last non-empty line of a file without streaming the whole thing. */
export function readLastLine(filePath: string): string {
  try {
    const fd = openSync(filePath, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) { closeSync(fd); return ''; }
    const readSize = Math.min(4096, size);
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, size - readSize);
    closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]?.trim();
      if (l) return l;
    }
    return '';
  } catch {
    return '';
  }
}

/** Read the tail of a JSONL file as parsed Messages. Used to seed the
 *  initial state without loading the entire history. ~64 KB covers a long
 *  recent window — enough to find any unmatched tool_use the tracker cares
 *  about for the in-flight grace window (30s) and permission gate (3s). */
export function readTailMessages(filePath: string, byteLimit = 64 * 1024): Message[] {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const size = fstatSync(fd).size;
    if (size === 0) return [];
    const readSize = Math.min(byteLimit, size);
    const buf = Buffer.alloc(readSize);
    readSync(fd, buf, 0, readSize, size - readSize);
    let text = buf.toString('utf8');
    // If we sliced the file mid-line, drop the leading partial line.
    if (size > readSize) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return text.split('\n').flatMap(parseLine);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* ignore */ }
    }
  }
}

export interface TailMeta {
  /** Latest assistant-text.model in the tail, if any. */
  model: string | null;
  /** Latest user-prompt.permissionMode in the tail, if any. */
  permissionMode: string | null;
  /** ISO timestamp of the most recent user-prompt in the tail, if any. */
  lastUserInputAt: string | null;
  /** Sum of input+output tokens from assistant-usage events in the tail. */
  tokens: number;
  /** Most recent session-result cost in the tail (cumulative). */
  costUsd: number;
  /** Count of user-prompt + assistant-text events in the tail. */
  messageCount: number;
}

/** Walk a list of messages once and pull out the fields that change
 *  over a session's lifetime (model swaps, permission-mode toggles)
 *  plus running totals. The same pass is used by initial listing and by
 *  the meta-watcher on every file change, so both paths see consistent
 *  values. Latest-wins for single-valued fields. */
export function extractTailMeta(messages: Message[]): TailMeta {
  let model: string | null = null;
  let permissionMode: string | null = null;
  let lastUserInputAt: string | null = null;
  let tokens = 0;
  let costUsd = 0;
  let messageCount = 0;

  for (const m of messages) {
    if (m.kind === 'assistant-usage') tokens += m.inputTokens + m.outputTokens;
    if (m.kind === 'session-result') costUsd = m.costUsd;
    if (m.kind === 'user-prompt' || m.kind === 'assistant-text') messageCount++;
    if (m.kind === 'assistant-text' && m.model) model = m.model;
    if (m.kind === 'user-prompt') {
      lastUserInputAt = m.ts;
      if (typeof m.permissionMode === 'string') permissionMode = m.permissionMode;
    }
  }

  return { model, permissionMode, lastUserInputAt, tokens, costUsd, messageCount };
}

export async function listClaudeCodeSessions(rootPath: string): Promise<SessionMeta[]> {
  const projectsDir = path.join(rootPath, 'projects');
  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(projectsDir);
  } catch {
    return [];
  }

  const out: SessionMeta[] = [];

  for (const projectDir of projectDirs) {
    const fullProjectPath = path.join(projectsDir, projectDir);
    let stats;
    try {
      stats = await fs.stat(fullProjectPath);
    } catch {
      continue;
    }
    if (!stats.isDirectory()) continue;

    let entries: string[];
    try {
      entries = await fs.readdir(fullProjectPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;
      // Sub-agent sidechains (agent-*.jsonl) are Task tool invocations
      // spawned by a parent session. Hide them from the top-level list.
      if (entry.startsWith('agent-')) continue;
      const filePath = path.join(fullProjectPath, entry);
      const meta = await readSessionMeta(filePath, projectDir);
      if (meta) out.push(meta);
    }
  }

  // Most recently active first.
  out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return out;
}

async function readSessionMeta(filePath: string, encodedProjectDir: string): Promise<SessionMeta | null> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch {
    return null;
  }
  if (stat.size === 0) return null;

  const sessionId = path.basename(filePath, '.jsonl');
  const isSidechain = path.basename(filePath).startsWith('agent-');

  // Read the first ~50 lines to find the head metadata, the first user
  // message, model info, etc. 50 is generous and still cheap.
  const headLines: string[] = [];
  const HEAD_LINES = 50;

  await new Promise<void>((resolve) => {
    const stream = createReadStream(filePath, { encoding: 'utf-8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let count = 0;
    rl.on('line', (line) => {
      headLines.push(line);
      if (++count >= HEAD_LINES) rl.close();
    });
    rl.on('close', () => resolve());
    rl.on('error', () => resolve());
  });

  // Defaults; we'll overwrite as we find values in the head.
  let cwd = decodeProjectDir(encodedProjectDir);
  let projectLabel = path.basename(cwd);
  let gitBranch: string | null = null;
  let model: string | null = null;
  let permissionMode: string | null = null;
  let entrypoint: string | null = null;
  let agentVersion: string | null = null;
  let firstUserMessage: string | null = null;
  let startedAt = stat.birthtime.toISOString();

  for (const line of headLines) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try { raw = JSON.parse(line); } catch { continue; }

    if (typeof raw['cwd'] === 'string') cwd = raw['cwd'] as string;
    if (typeof raw['gitBranch'] === 'string') gitBranch = raw['gitBranch'] as string;
    if (typeof raw['permissionMode'] === 'string') permissionMode = raw['permissionMode'] as string;
    if (typeof raw['entrypoint'] === 'string') entrypoint = raw['entrypoint'] as string;
    if (typeof raw['version'] === 'string') agentVersion = raw['version'] as string;
    if (typeof raw['timestamp'] === 'string' && raw['type'] !== 'queue-operation') {
      startedAt = raw['timestamp'] as string;
    }

    if (raw['type'] === 'assistant') {
      const msg = raw['message'] as { model?: string } | undefined;
      if (msg?.model && !model) model = msg.model;
    }

    if (firstUserMessage === null) {
      const messages = parseLine(line);
      const userPrompt = messages.find(m => m.kind === 'user-prompt');
      if (userPrompt && userPrompt.kind === 'user-prompt') {
        firstUserMessage = userPrompt.text.slice(0, 200);
      }
    }
  }

  if (cwd) projectLabel = path.basename(cwd);

  const lastActivityAt = stat.mtime.toISOString();

  // Compute the initial state from the tail of the file.
  const tailMessages = readTailMessages(filePath);
  const state = computeState({
    messages: tailMessages,
    lastEventAt: stat.mtime.getTime(),
    permissionMode,
    now: Date.now(),
  });

  // Pull freshable fields out of the tail (model/permissionMode/totals).
  // For files smaller than the 64KB tail window this is exact; for larger
  // files the totals are partial until the user opens the session and
  // sessions:get does a full pass that overwrites these via updateMeta.
  const tailMeta = extractTailMeta(tailMessages);
  if (tailMeta.model) model = tailMeta.model;
  if (tailMeta.permissionMode) permissionMode = tailMeta.permissionMode;

  const { modelClass, modelProvider } = classifyModel(model);

  return {
    id: sessionId,
    adapter: 'claude-code',
    cwd,
    projectLabel,
    filePath,
    gitBranch,
    startedAt,
    lastActivityAt,
    lastUserInputAt: tailMeta.lastUserInputAt,
    state,
    isSidechain,
    parentSessionId: null,
    messageCount: tailMeta.messageCount,
    totalTokens: tailMeta.tokens,
    totalCostUsd: tailMeta.costUsd,
    model,
    modelClass,
    modelProvider,
    permissionMode,
    entrypoint,
    agentVersion,
    firstUserMessage,
  };
}

/** Claude Code encodes project paths by replacing `/` with `-`. The
 *  encoding is lossy (a literal `-` in a path is indistinguishable from a
 *  separator), so we prefer the `cwd` field from event records when
 *  available and fall back to this only as a default. */
function decodeProjectDir(encoded: string): string {
  return encoded.startsWith('-') ? encoded.replace(/^-/, '/').replace(/-/g, '/') : encoded;
}
