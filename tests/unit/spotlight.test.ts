/**
 * Tests for the filesystem search fallback (spotlight.ts).
 *
 * Mocks child_process.spawn to verify the right platform command is invoked
 * and that results are classified correctly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── spawn mock ────────────────────────────────────────────────────────────────

let spawnCmd = '';
let spawnArgs: string[] = [];
let spawnOutput = '';

vi.mock('node:child_process', () => ({
  spawn: (cmd: string, args: string[]) => {
    spawnCmd = cmd;
    spawnArgs = args;
    const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void };
    proc.stdout = new EventEmitter();
    proc.kill = () => { /* no-op */ };
    // Emit output asynchronously so the caller's listeners are registered first.
    setImmediate(() => {
      proc.stdout.emit('data', spawnOutput);
      proc.emit('close', 0);
    });
    return proc;
  },
}));

let mockPlatform: NodeJS.Platform = 'darwin';
Object.defineProperty(process, 'platform', {
  get: () => mockPlatform,
  configurable: true,
});

import { searchFilesystemForAgentData } from '../../src/main/discovery/spotlight';

beforeEach(() => {
  spawnCmd = '';
  spawnArgs = [];
  spawnOutput = '';
  mockPlatform = 'darwin';
});

// ── platform command dispatch ─────────────────────────────────────────────────

describe('searchFilesystemForAgentData — platform commands', () => {
  it('macOS uses mdfind', async () => {
    mockPlatform = 'darwin';
    spawnOutput = '';
    await searchFilesystemForAgentData(new AbortController().signal);
    expect(spawnCmd).toBe('mdfind');
  });

  it('windows uses powershell', async () => {
    mockPlatform = 'win32';
    spawnOutput = '';
    await searchFilesystemForAgentData(new AbortController().signal);
    expect(spawnCmd).toBe('powershell');
  });

  it('linux uses find', async () => {
    mockPlatform = 'linux';
    spawnOutput = '';
    await searchFilesystemForAgentData(new AbortController().signal);
    expect(spawnCmd).toBe('find');
  });
});

// ── result classification ─────────────────────────────────────────────────────

describe('searchFilesystemForAgentData — result classification', () => {
  it('classifies .claude path as claude-code high confidence', async () => {
    mockPlatform = 'darwin';
    spawnOutput = '/Users/demo/.claude\n';
    const results = await searchFilesystemForAgentData(new AbortController().signal);
    expect(results).toHaveLength(1);
    expect(results[0]?.adapter).toBe('claude-code');
    expect(results[0]?.confidence).toBe('high');
    expect(results[0]?.path).toBe('/Users/demo/.claude');
  });

  it('classifies saoudrizwan.claude-dev path as cline high confidence', async () => {
    mockPlatform = 'darwin';
    spawnOutput = '/Users/demo/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev\n';
    const results = await searchFilesystemForAgentData(new AbortController().signal);
    expect(results).toHaveLength(1);
    expect(results[0]?.adapter).toBe('cline');
    expect(results[0]?.confidence).toBe('high');
  });

  it('deduplicates identical paths', async () => {
    mockPlatform = 'darwin';
    spawnOutput = '/Users/demo/.claude\n/Users/demo/.claude\n';
    const results = await searchFilesystemForAgentData(new AbortController().signal);
    expect(results).toHaveLength(1);
  });

  it('returns empty array when no known paths found', async () => {
    mockPlatform = 'darwin';
    spawnOutput = '/Users/demo/some-random-dir\n';
    const results = await searchFilesystemForAgentData(new AbortController().signal);
    expect(results).toHaveLength(0);
  });

  it('returns empty array when output is empty', async () => {
    mockPlatform = 'darwin';
    spawnOutput = '';
    const results = await searchFilesystemForAgentData(new AbortController().signal);
    expect(results).toHaveLength(0);
  });
});

// ── abort signal ──────────────────────────────────────────────────────────────

describe('searchFilesystemForAgentData — abort', () => {
  it('returns empty when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const results = await searchFilesystemForAgentData(ac.signal);
    expect(results).toEqual([]);
  });
});
