/**
 * Integration tests for listClaudeCodeSessions.
 *
 * These tests write real files into a temp directory so we exercise the
 * actual fs/readline path instead of mocking it. Each test gets its own
 * isolated directory, cleaned up in afterEach.
 *
 * Scenarios covered:
 *   - Empty / missing projects dir → returns []
 *   - agent-*.jsonl sidechains are skipped
 *   - Empty JSONL files are skipped
 *   - Minimal valid session produces correct SessionMeta fields
 *   - cwd, gitBranch, model extracted from JSONL events
 *   - isActive derived from file mtime
 *   - projectLabel falls back to decoded directory name
 *   - Multiple sessions in one project directory
 *   - Multiple project directories
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { listClaudeCodeSessions } from '../../src/main/adapters/claude-code/lister';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

async function makeTmpRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'helm-lister-test-'));
}

async function writeJsonlFile(
  rootPath: string,
  projectDir: string,
  fileName: string,
  lines: object[],
): Promise<string> {
  const dir = path.join(rootPath, 'projects', projectDir);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return filePath;
}

const roots: string[] = [];

afterEach(async () => {
  for (const r of roots.splice(0)) {
    await fs.rm(r, { recursive: true, force: true });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('listClaudeCodeSessions — missing / empty dirs', () => {
  it('returns [] when root path does not exist', async () => {
    const result = await listClaudeCodeSessions('/does/not/exist/helm-test');
    expect(result).toEqual([]);
  });

  it('returns [] when projects/ subdir is missing', async () => {
    const root = await makeTmpRoot();
    roots.push(root);
    const result = await listClaudeCodeSessions(root);
    expect(result).toEqual([]);
  });

  it('returns [] when projects/ exists but is empty', async () => {
    const root = await makeTmpRoot();
    roots.push(root);
    await fs.mkdir(path.join(root, 'projects'));
    const result = await listClaudeCodeSessions(root);
    expect(result).toEqual([]);
  });
});

describe('listClaudeCodeSessions — sidechain filtering', () => {
  it('skips agent-*.jsonl files entirely', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } },
    ];

    // Real session file (should be included)
    await writeJsonlFile(root, '-Users-dev-project', 'main-session.jsonl', lines);
    // Sidechain file (should be excluded)
    await writeJsonlFile(root, '-Users-dev-project', 'agent-abc123.jsonl', lines);

    const result = await listClaudeCodeSessions(root);
    expect(result).toHaveLength(1);
    expect(result[0]?.filePath).toContain('main-session.jsonl');
  });
});

describe('listClaudeCodeSessions — empty JSONL', () => {
  it('skips zero-byte files', async () => {
    const root = await makeTmpRoot();
    roots.push(root);
    const dir = path.join(root, 'projects', '-Users-dev-project');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'empty.jsonl'), '', 'utf-8');
    const result = await listClaudeCodeSessions(root);
    expect(result).toEqual([]);
  });
});

describe('listClaudeCodeSessions — metadata extraction', () => {
  it('extracts cwd, gitBranch, and model from JSONL events', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      {
        type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        cwd: '/Users/dev/audiosnap',
        gitBranch: 'feature/waveform',
        permissionMode: 'acceptEdits',
        version: '2.1.0',
        message: { role: 'user', content: [{ type: 'text', text: 'Add waveform display' }] },
      },
      {
        type: 'assistant', uuid: 'a1', timestamp: '2026-05-02T10:00:01.000Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-7',
          content: [{ type: 'text', text: "I'll add that." }],
        },
      },
    ];

    await writeJsonlFile(root, '-Users-dev-audiosnap', 'session1.jsonl', lines);

    const [meta] = await listClaudeCodeSessions(root);

    expect(meta?.cwd).toBe('/Users/dev/audiosnap');
    expect(meta?.gitBranch).toBe('feature/waveform');
    expect(meta?.model).toBe('claude-opus-4-7');
    expect(meta?.modelClass).toBe('cloud');
    expect(meta?.modelProvider).toBe('anthropic');
    expect(meta?.permissionMode).toBe('acceptEdits');
    expect(meta?.agentVersion).toBe('2.1.0');
    expect(meta?.firstUserMessage).toBe('Add waveform display');
    expect(meta?.projectLabel).toBe('audiosnap');
    expect(meta?.adapter).toBe('claude-code');
    expect(meta?.isSidechain).toBe(false);
  });

  it('sets projectLabel from basename of cwd', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        cwd: '/Users/dev/my-project',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
    ];
    await writeJsonlFile(root, '-Users-dev-my-project', 's.jsonl', lines);

    const [meta] = await listClaudeCodeSessions(root);
    expect(meta?.projectLabel).toBe('my-project');
  });

  it('falls back to decoded directory name when cwd not in JSONL', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    // Only a bare assistant event — no cwd field
    const lines = [
      { type: 'assistant', uuid: 'a1', timestamp: '2026-05-02T10:00:00.000Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'Hello!' }] } },
    ];
    await writeJsonlFile(root, '-Users-dev-fallback', 's.jsonl', lines);

    const [meta] = await listClaudeCodeSessions(root);
    // Directory `-Users-dev-fallback` decodes to `/Users/dev/fallback`
    expect(meta?.projectLabel).toBe('fallback');
  });

  it('produces null model/gitBranch when not present in JSONL', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        cwd: '/Users/dev/bare',
        message: { role: 'user', content: [{ type: 'text', text: 'bare session' }] } },
    ];
    await writeJsonlFile(root, '-Users-dev-bare', 's.jsonl', lines);

    const [meta] = await listClaudeCodeSessions(root);
    expect(meta?.model).toBeNull();
    expect(meta?.gitBranch).toBeNull();
    expect(meta?.modelClass).toBe('unknown');
    expect(meta?.modelProvider).toBeNull();
  });
});

describe('listClaudeCodeSessions — initial state', () => {
  it('marks a recently-touched file with an unanswered user prompt as working', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: new Date().toISOString(),
        cwd: '/Users/dev/active',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
    ];
    const filePath = await writeJsonlFile(root, '-Users-dev-active', 's.jsonl', lines);

    const now = new Date();
    await fs.utimes(filePath, now, now);

    const [meta] = await listClaudeCodeSessions(root);
    expect(meta?.state.kind).toBe('working');
  });

  it('marks an old file with an assistant reply as awaiting-user with stale freshness', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/Users/dev/old',
        message: { role: 'user', content: [{ type: 'text', text: 'old' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'done' }] } },
    ];
    const filePath = await writeJsonlFile(root, '-Users-dev-old', 's.jsonl', lines);

    // Set mtime to 2 hours ago — well past the 60-min recent threshold.
    const old = new Date(Date.now() - 2 * 60 * 60_000);
    await fs.utimes(filePath, old, old);

    const [meta] = await listClaudeCodeSessions(root);
    expect(meta?.state.kind).toBe('awaiting-user');
    if (meta?.state.kind === 'awaiting-user') {
      expect(meta.state.freshnessTier).toBe('stale');
    }
  });
});

describe('listClaudeCodeSessions — sorting and multiple sessions', () => {
  it('returns sessions sorted newest lastActivityAt first', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const makeLines = (ts: string, text: string) => [
      { type: 'user', uuid: 'u1', timestamp: ts,
        cwd: '/Users/dev/proj',
        message: { role: 'user', content: [{ type: 'text', text }] } },
    ];

    const dir = path.join(root, 'projects', '-Users-dev-proj');
    await fs.mkdir(dir, { recursive: true });

    const old  = path.join(dir, 'old.jsonl');
    const newS = path.join(dir, 'new.jsonl');

    await fs.writeFile(old,  makeLines('2026-01-01T00:00:00.000Z', 'old session').map(l => JSON.stringify(l)).join('\n'), 'utf-8');
    await fs.writeFile(newS, makeLines('2026-05-02T12:00:00.000Z', 'new session').map(l => JSON.stringify(l)).join('\n'), 'utf-8');

    // Set mtime to match the intended order
    const oldTime = new Date('2026-01-01T00:00:00.000Z');
    const newTime = new Date('2026-05-02T12:00:00.000Z');
    await fs.utimes(old,  oldTime, oldTime);
    await fs.utimes(newS, newTime, newTime);

    const result = await listClaudeCodeSessions(root);
    expect(result).toHaveLength(2);
    expect(result[0]?.firstUserMessage).toBe('new session');
    expect(result[1]?.firstUserMessage).toBe('old session');
  });

  it('handles multiple project directories', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const linesA = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        cwd: '/Users/dev/projectA',
        message: { role: 'user', content: [{ type: 'text', text: 'project A' }] } },
    ];
    const linesB = [
      { type: 'user', uuid: 'u2', timestamp: '2026-05-02T11:00:00.000Z',
        cwd: '/Users/dev/projectB',
        message: { role: 'user', content: [{ type: 'text', text: 'project B' }] } },
    ];

    await writeJsonlFile(root, '-Users-dev-projectA', 's.jsonl', linesA);
    await writeJsonlFile(root, '-Users-dev-projectB', 's.jsonl', linesB);

    const result = await listClaudeCodeSessions(root);
    expect(result).toHaveLength(2);
    const labels = result.map(s => s.projectLabel).sort();
    expect(labels).toEqual(['projectA', 'projectB']);
  });
});

describe('listClaudeCodeSessions — freshable fields (model / permissionMode / totals)', () => {
  it('reports the LATEST model from the tail, not the first one in the head', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        permissionMode: 'default',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: '2026-05-02T10:00:01.000Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'first reply' }] } },
      // User swaps model.
      { type: 'user', uuid: 'u2', timestamp: '2026-05-02T10:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'use opus' }] } },
      { type: 'assistant', uuid: 'a2', timestamp: '2026-05-02T10:01:01.000Z',
        message: { role: 'assistant', model: 'claude-opus-4-7',
          content: [{ type: 'text', text: 'opus reply' }] } },
    ];

    await writeJsonlFile(root, '-Users-dev-project', 's.jsonl', lines);
    const result = await listClaudeCodeSessions(root);
    expect(result[0]?.model).toBe('claude-opus-4-7');
  });

  it('reports the LATEST permissionMode, not the one from the first user-prompt', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        permissionMode: 'default',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: '2026-05-02T10:00:01.000Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text: 'ok' }] } },
      // User toggles to acceptEdits.
      { type: 'user', uuid: 'u2', timestamp: '2026-05-02T10:01:00.000Z',
        permissionMode: 'acceptEdits',
        message: { role: 'user', content: [{ type: 'text', text: 'switch to acceptEdits' }] } },
    ];

    await writeJsonlFile(root, '-Users-dev-project', 's.jsonl', lines);
    const result = await listClaudeCodeSessions(root);
    expect(result[0]?.permissionMode).toBe('acceptEdits');
  });

  it('populates messageCount and totalTokens from assistant-usage events in the tail', async () => {
    const root = await makeTmpRoot();
    roots.push(root);

    const lines = [
      { type: 'user', uuid: 'u1', timestamp: '2026-05-02T10:00:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'first' }] } },
      { type: 'assistant', uuid: 'a1', timestamp: '2026-05-02T10:00:01.000Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          usage: { input_tokens: 100, output_tokens: 50 },
          content: [{ type: 'text', text: 'reply 1' }] } },
      { type: 'user', uuid: 'u2', timestamp: '2026-05-02T10:01:00.000Z',
        message: { role: 'user', content: [{ type: 'text', text: 'second' }] } },
      { type: 'assistant', uuid: 'a2', timestamp: '2026-05-02T10:01:01.000Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-6',
          usage: { input_tokens: 200, output_tokens: 80 },
          content: [{ type: 'text', text: 'reply 2' }] } },
    ];

    await writeJsonlFile(root, '-Users-dev-project', 's.jsonl', lines);
    const result = await listClaudeCodeSessions(root);
    // 2 user-prompts + 2 assistant-text = 4
    expect(result[0]?.messageCount).toBe(4);
    // (100+50) + (200+80) = 430
    expect(result[0]?.totalTokens).toBe(430);
  });
});
