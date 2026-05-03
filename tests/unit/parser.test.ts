/**
 * Parser tests. All fixtures are based on real shapes observed in
 * Claude Code v2.1.x session files.
 */

import { describe, it, expect } from 'vitest';
import { parseLine, parseAll } from '../../src/main/adapters/claude-code/parser';

describe('parseLine', () => {
  it('drops queue-operation events entirely', () => {
    const line = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2026-04-20T05:55:31.355Z',
      sessionId: 'abc',
    });
    expect(parseLine(line)).toEqual([]);
  });

  it('drops Claude Code internal scaffolding event types', () => {
    // Without this, every TodoWrite/Edit was followed by a [unknown] pill in the timeline.
    const noisyTypes = ['file-history-snapshot', 'ai-title', 'last-prompt', 'summary', 'system'];
    for (const type of noisyTypes) {
      const line = JSON.stringify({ type, uuid: 'x', timestamp: '2026-05-03T10:00:00.000Z' });
      expect(parseLine(line), `${type} should be dropped`).toEqual([]);
    }
  });

  it('preserves TodoWrite tool_use input for the renderer to display as a checklist', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a-todo-1',
      timestamp: '2026-05-03T10:00:00.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [{
          type: 'tool_use', id: 'tu_todo', name: 'TodoWrite',
          input: { todos: [
            { content: 'Refactor parser', status: 'completed', activeForm: 'Refactoring parser' },
            { content: 'Add tests', status: 'in_progress', activeForm: 'Adding tests' },
            { content: 'Update docs', status: 'pending', activeForm: 'Updating docs' },
          ]},
        }],
      },
    });
    const out = parseLine(line);
    const call = out.find(m => m.kind === 'tool-call');
    expect(call?.kind).toBe('tool-call');
    if (call?.kind === 'tool-call') {
      expect(call.tool).toBe('TodoWrite');
      const input = call.input as { todos?: unknown[] };
      expect(Array.isArray(input.todos)).toBe(true);
      expect(input.todos).toHaveLength(3);
    }
  });

  it('handles malformed JSON without throwing', () => {
    expect(parseLine('{ this is not json')).toEqual([]);
    expect(parseLine('')).toEqual([]);
    expect(parseLine('   ')).toEqual([]);
  });

  it('parses a user message and separates IDE context from real prompt', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-04-20T05:55:31.415Z',
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '<ide_opened_file>The user opened /foo/bar.ts</ide_opened_file>' },
          { type: 'text', text: 'Please make the cursor a crosshair' },
        ],
      },
    });
    const out = parseLine(line);
    expect(out).toHaveLength(1);
    const msg = out[0]!;
    expect(msg.kind).toBe('user-prompt');
    if (msg.kind !== 'user-prompt') throw new Error();
    expect(msg.text).toBe('Please make the cursor a crosshair');
    expect(msg.ideContext).toHaveLength(1);
    expect(msg.ideContext[0]).toContain('<ide_opened_file>');
  });

  it('parses an assistant message with multiple content blocks', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-04-20T05:55:32.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-7',
        content: [
          { type: 'thinking', thinking: 'The user wants a crosshair cursor.' },
          { type: 'text', text: "I'll update your CSS." },
          { type: 'tool_use', id: 'tu_1', name: 'Edit', input: { file_path: '/foo/bar.css', old_string: 'auto', new_string: 'crosshair' } },
        ],
      },
    });
    const out = parseLine(line);
    expect(out).toHaveLength(3);
    expect(out.map(m => m.kind)).toEqual(['assistant-thinking', 'assistant-text', 'tool-call']);

    // Verify the actual thinking text was extracted from content[i].thinking,
    // not just that an assistant-thinking message was emitted.
    const thinking = out.find(m => m.kind === 'assistant-thinking');
    if (thinking?.kind === 'assistant-thinking') {
      expect(thinking.text).toBe('The user wants a crosshair cursor.');
    }
  });

  it('extracts thinking text even when block carries a signature field', () => {
    // Real Claude Code thinking blocks include a `signature` field alongside
    // the `thinking` text. Make sure the extra field doesn't trip the parser.
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a-think-1',
      timestamp: '2026-05-03T09:31:18.835Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-4-7',
        content: [
          { type: 'thinking', thinking: 'I need to consider the trade-offs.', signature: 'abc123' },
        ],
      },
    });
    const out = parseLine(line);
    const thinking = out.find(m => m.kind === 'assistant-thinking');
    expect(thinking?.kind).toBe('assistant-thinking');
    if (thinking?.kind === 'assistant-thinking') {
      expect(thinking.text).toBe('I need to consider the trade-offs.');
    }
  });

  it('extracts tool results from user-typed events with tool_result blocks', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'r1',
      timestamp: '2026-04-20T05:55:33.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'File written', is_error: false },
        ],
      },
    });
    const out = parseLine(line);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('tool-result');
    if (out[0]?.kind === 'tool-result') {
      expect(out[0].toolUseId).toBe('tu_1');
      expect(out[0].isError).toBe(false);
    }
  });

  it('does NOT mark a tool-result as error when is_error: true but no isApiErrorMessage', () => {
    // Permission denials and ordinary tool errors carry is_error: true on the
    // block but should not show the red error treatment in the UI.
    const line = JSON.stringify({
      type: 'user',
      uuid: 'r-deny',
      timestamp: '2026-05-03T10:00:00.000Z',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'Error: Request denied', is_error: true },
        ],
      },
    });
    const out = parseLine(line);
    const tr = out.find(m => m.kind === 'tool-result');
    expect(tr?.kind).toBe('tool-result');
    if (tr?.kind === 'tool-result') {
      expect(tr.isError).toBe(false);
    }
  });

  it('marks a tool-result as error when is_error: true AND isApiErrorMessage: true', () => {
    const line = JSON.stringify({
      type: 'user',
      uuid: 'r-api',
      timestamp: '2026-05-03T10:00:00.000Z',
      isApiErrorMessage: true,
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_3', content: 'API connection error', is_error: true },
        ],
      },
    });
    const out = parseLine(line);
    const tr = out.find(m => m.kind === 'tool-result');
    expect(tr?.kind).toBe('tool-result');
    if (tr?.kind === 'tool-result') {
      expect(tr.isError).toBe(true);
    }
  });

  it('classifies attachment events as env-metadata', () => {
    const line = JSON.stringify({
      type: 'attachment',
      uuid: 'att1',
      timestamp: '2026-04-20T05:55:31.500Z',
      attachment: { type: 'skill_listing', content: '...', skillCount: 12 },
    });
    const out = parseLine(line);
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('env-metadata');
    if (out[0]?.kind === 'env-metadata') {
      expect(out[0].subtype).toBe('skill_listing');
    }
  });

  it('emits unknown events with the raw blob preserved', () => {
    const raw = { type: 'totally-new-event-type', uuid: 'x', timestamp: '2026-04-20T05:55:34.000Z', whatever: 42 };
    const out = parseLine(JSON.stringify(raw));
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe('unknown');
    if (out[0]?.kind === 'unknown') {
      expect(out[0].raw).toMatchObject({ type: 'totally-new-event-type', whatever: 42 });
    }
  });

  it('captures stop_reason on assistant-text — end_turn', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a-end',
      timestamp: '2026-04-20T05:55:32.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-7',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done!' }],
      },
    });
    const out = parseLine(line);
    const text = out.find(m => m.kind === 'assistant-text');
    expect(text).toBeDefined();
    if (text?.kind === 'assistant-text') {
      expect(text.stopReason).toBe('end_turn');
    }
  });

  it('captures stop_reason on assistant-text — tool_use (mid-turn)', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a-mid',
      timestamp: '2026-04-20T05:55:32.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-7',
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: "I'll edit the file." },
          { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/x' } },
        ],
      },
    });
    const out = parseLine(line);
    const text = out.find(m => m.kind === 'assistant-text');
    expect(text).toBeDefined();
    if (text?.kind === 'assistant-text') {
      expect(text.stopReason).toBe('tool_use');
    }
  });

  it('omits stopReason when raw message has no stop_reason field', () => {
    const line = JSON.stringify({
      type: 'assistant',
      uuid: 'a-no-stop',
      timestamp: '2026-04-20T05:55:32.000Z',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-7',
        content: [{ type: 'text', text: 'partial' }],
      },
    });
    const out = parseLine(line);
    const text = out.find(m => m.kind === 'assistant-text');
    expect(text?.kind).toBe('assistant-text');
    if (text?.kind === 'assistant-text') {
      expect(text.stopReason).toBeUndefined();
    }
  });
});

describe('parseAll', () => {
  it('parses a multi-line JSONL string in order', () => {
    const lines = [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-04-20T05:55:31.355Z' }),
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-04-20T05:55:31.415Z',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'assistant', uuid: 'a1', timestamp: '2026-04-20T05:55:31.500Z',
        message: { role: 'assistant', model: 'claude-sonnet-4-7', content: [{ type: 'text', text: 'hello!' }] } }),
    ].join('\n');
    const out = parseAll(lines);
    expect(out.map(m => m.kind)).toEqual(['user-prompt', 'assistant-text']);
  });
});
