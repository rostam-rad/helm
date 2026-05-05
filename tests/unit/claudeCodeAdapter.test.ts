/**
 * Tests for the Claude Code adapter's validatePath — specifically the
 * granular ValidationFailure mapping introduced in v0.2 (audit #13).
 *
 * Uses a real temp directory rather than mocking node:fs, so the EACCES
 * mapping is exercised against actual chmod 0o000 paths. (Skipped on
 * Windows, where POSIX mode bits don't behave the same.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as fsSync from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { claudeCodeAdapter } from '../../src/main/adapters/claude-code';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'helm-validate-'));
});

afterEach(async () => {
  // Restore perms before deletion in case a test chmod'd to 0o000.
  try { await fs.chmod(tmpRoot, 0o755); } catch { /* ignore */ }
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('claudeCodeAdapter.validatePath', () => {
  it('returns not-found for a path that does not exist', async () => {
    const missing = path.join(tmpRoot, 'does-not-exist');
    const result = await claudeCodeAdapter.validatePath(missing);
    expect(result).toEqual({ ok: false, reason: 'not-found' });
  });

  it('returns no-projects-dir for a directory missing the projects/ subdir', async () => {
    const result = await claudeCodeAdapter.validatePath(tmpRoot);
    expect(result).toEqual({ ok: false, reason: 'no-projects-dir' });
  });

  it('returns ok with sessionCount: 0 for an empty projects/ subdir (no-sessions-yet UX trigger)', async () => {
    await fs.mkdir(path.join(tmpRoot, 'projects'));
    const result = await claudeCodeAdapter.validatePath(tmpRoot);
    expect(result).toEqual({ ok: true, sessionCount: 0 });
  });

  it('returns ok with positive sessionCount when a .jsonl file exists in a project subdir', async () => {
    const projectDir = path.join(tmpRoot, 'projects', '-Users-fake-project');
    await fs.mkdir(projectDir, { recursive: true });
    // Minimal valid-ish JSONL — listClaudeCodeSessions only needs a non-empty file.
    fsSync.writeFileSync(
      path.join(projectDir, 'a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl'),
      '{"type":"user","timestamp":"2026-05-03T12:00:00Z","message":{"content":"hi"}}\n',
    );
    const result = await claudeCodeAdapter.validatePath(tmpRoot);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sessionCount).toBeGreaterThanOrEqual(1);
  });

  it.skipIf(process.platform === 'win32')(
    'returns permission-denied when the root directory is not readable',
    async () => {
      // chmod 0o000 — fs.stat itself succeeds (you can stat without read
      // perms), but the projects/ probe inside fails with EACCES. Mapping
      // collapses to 'permission-denied' regardless of which probe trips it.
      await fs.chmod(tmpRoot, 0o000);
      const result = await claudeCodeAdapter.validatePath(path.join(tmpRoot, 'projects'));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('permission-denied');
    },
  );
});
