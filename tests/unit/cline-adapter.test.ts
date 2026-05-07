/**
 * Tests for the Cline adapter: parser, lister, and discovery.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { parseClineHistory } from '../../src/main/adapters/cline/parser';
import { listClineSessions } from '../../src/main/adapters/cline/lister';
import { discoverClinePaths } from '../../src/main/adapters/cline/discovery';

const FIXTURE_ROOT = path.join(__dirname, '../fixtures/cline');

// ── Parser ────────────────────────────────────────────────────────────────────

describe('parseClineHistory', () => {
  it('returns empty array for non-array input', () => {
    expect(parseClineHistory(null)).toEqual([]);
    expect(parseClineHistory('string')).toEqual([]);
    expect(parseClineHistory({})).toEqual([]);
  });

  it('parses user text block stripping <task> wrapper', () => {
    const raw = [{ role: 'user', content: [{ type: 'text', text: '<task>\nAdd README\n</task>' }] }];
    const msgs = parseClineHistory(raw);
    const prompt = msgs.find(m => m.kind === 'user-prompt');
    expect(prompt).toBeDefined();
    expect(prompt?.kind === 'user-prompt' && prompt.text).toBe('Add README');
  });

  it('parses assistant text block', () => {
    const raw = [{ role: 'assistant', content: [{ type: 'text', text: "I'll help you." }] }];
    const msgs = parseClineHistory(raw);
    const text = msgs.find(m => m.kind === 'assistant-text');
    expect(text?.kind === 'assistant-text' && text.text).toBe("I'll help you.");
  });

  it('parses tool_use block as tool-call', () => {
    const raw = [{
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'tu1', name: 'write_to_file', input: { path: 'README.md' } }],
    }];
    const msgs = parseClineHistory(raw);
    const tc = msgs.find(m => m.kind === 'tool-call');
    expect(tc?.kind === 'tool-call' && tc.tool).toBe('write_to_file');
    expect(tc?.kind === 'tool-call' && tc.toolUseId).toBe('tu1');
  });

  it('parses tool_result block as tool-result', () => {
    const raw = [{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'File saved.' }],
    }];
    const msgs = parseClineHistory(raw);
    const tr = msgs.find(m => m.kind === 'tool-result');
    expect(tr?.kind === 'tool-result' && tr.output).toBe('File saved.');
    expect(tr?.kind === 'tool-result' && tr.toolUseId).toBe('tu1');
  });

  it('emits assistant-usage when usage is present', () => {
    const raw = [{
      role: 'assistant',
      content: [{ type: 'text', text: 'Hi', usage: { input_tokens: 100, output_tokens: 20 } }],
    }];
    const msgs = parseClineHistory(raw);
    const usage = msgs.find(m => m.kind === 'assistant-usage');
    expect(usage?.kind === 'assistant-usage' && usage.inputTokens).toBe(100);
    expect(usage?.kind === 'assistant-usage' && usage.outputTokens).toBe(20);
  });

  it('skips empty assistant text blocks', () => {
    const raw = [{ role: 'assistant', content: [{ type: 'text', text: '   ' }] }];
    const msgs = parseClineHistory(raw);
    expect(msgs.filter(m => m.kind === 'assistant-text')).toHaveLength(0);
  });

  it('parses fixture task-abc123 correctly', async () => {
    const { readFile } = await import('node:fs/promises');
    const raw = JSON.parse(await readFile(
      path.join(FIXTURE_ROOT, 'tasks/task-abc123/api_conversation_history.json'), 'utf-8',
    ));
    const msgs = parseClineHistory(raw);
    expect(msgs.some(m => m.kind === 'user-prompt')).toBe(true);
    expect(msgs.some(m => m.kind === 'assistant-text')).toBe(true);
    expect(msgs.some(m => m.kind === 'tool-call')).toBe(true);
    expect(msgs.some(m => m.kind === 'tool-result')).toBe(true);
  });
});

// ── Lister ────────────────────────────────────────────────────────────────────

describe('listClineSessions', () => {
  it('returns sessions for fixture directory', async () => {
    const sessions = await listClineSessions(FIXTURE_ROOT);
    expect(sessions.length).toBeGreaterThanOrEqual(2);
  });

  it('session IDs are prefixed with cline:', async () => {
    const sessions = await listClineSessions(FIXTURE_ROOT);
    for (const s of sessions) {
      expect(s.id).toMatch(/^cline:/);
      expect(s.adapter).toBe('cline');
    }
  });

  it('session from task-abc123 has correct model and cost', async () => {
    const sessions = await listClineSessions(FIXTURE_ROOT);
    const s = sessions.find(s => s.id === 'cline:task-abc123');
    expect(s).toBeDefined();
    expect(s?.model).toBe('claude-sonnet-4-5');
    expect(s?.totalCostUsd).toBeCloseTo(0.0012);
  });

  it('session from task-def456 is in working state (unanswered tool-call)', async () => {
    const sessions = await listClineSessions(FIXTURE_ROOT);
    const s = sessions.find(s => s.id === 'cline:task-def456');
    expect(s).toBeDefined();
    // task-def456 ends with an unanswered execute_command tool-call
    // so state should be working (within grace window) or awaiting-user
    expect(['working', 'awaiting-user']).toContain(s?.state.kind);
  });

  it('returns empty array for non-existent directory', async () => {
    const sessions = await listClineSessions('/does/not/exist');
    expect(sessions).toEqual([]);
  });
});

// ── Discovery ─────────────────────────────────────────────────────────────────

describe('discoverClinePaths', () => {
  it('returns an array of strings', () => {
    const paths = discoverClinePaths();
    expect(Array.isArray(paths)).toBe(true);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(typeof p).toBe('string');
  });

  it('all paths include the extension id', () => {
    const paths = discoverClinePaths();
    for (const p of paths) {
      expect(p).toContain('saoudrizwan.claude-dev');
    }
  });
});
