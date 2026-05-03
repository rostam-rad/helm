/**
 * Claude Code JSONL parser.
 *
 * Source format: each line of a `.jsonl` file is one event. Documented
 * informally at best — this parser is built against real session data and
 * defends against everything else with `kind: 'unknown'` records.
 *
 * The parser is a pure function from `string` (a single JSONL line) to
 * `Message | null`. It never performs I/O, never throws on bad input, and
 * never mutates anything. That makes it trivial to unit test — the only
 * inputs are strings, the only outputs are records.
 *
 * Streaming is the caller's job (see watcher.ts). The parser doesn't know
 * or care whether a line came from disk, a fixture, or a test.
 *
 * Event types observed in real data (Claude Code v2.1.x):
 *   - queue-operation         (internal scheduling — dropped entirely)
 *   - user                    (user message; may include IDE auto-context)
 *   - assistant               (assistant turn; content is array of blocks)
 *   - attachment              (env metadata — tool deltas, skill listings)
 *   - file-history-snapshot   (file checkpoint; v0.4 will use these)
 *   - summary                 (compaction summaries)
 *
 * Assistant `message.content[]` block types:
 *   - text         → assistant-text
 *   - thinking     → assistant-thinking
 *   - tool_use     → tool-call
 *
 * Tool results are top-level `user`-typed events whose content[] contains
 * `{type: 'tool_result', tool_use_id, content}` blocks. We surface them as
 * `tool-result` so the renderer can attach them to their parent tool_use.
 */

import type { Message } from '../../../shared/types';

/** Drops the leading `<ide_*>...</ide_*>` blocks (auto-injected IDE context)
 *  and returns them separately so the renderer can show them as small badges
 *  rather than confusing them with the user's actual prompt. */
function splitIdeContext(blocks: TextBlock[]): { ideContext: string[]; text: string } {
  const ideContext: string[] = [];
  const realText: string[] = [];
  for (const block of blocks) {
    const trimmed = block.text.trim();
    if (trimmed.startsWith('<ide_') || trimmed.startsWith('<system-reminder>')) {
      ideContext.push(trimmed);
    } else {
      realText.push(block.text);
    }
  }
  return { ideContext, text: realText.join('\n\n').trim() };
}

interface TextBlock { type: 'text'; text: string }
interface ThinkingBlock { type: 'thinking'; thinking: string }
interface ToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
interface ToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string | TextBlock[]; is_error?: boolean }

type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | { type: string; [k: string]: unknown };

interface RawEventBase {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
}

/** Parse a single JSONL line. Returns null for events we want to drop entirely
 *  (e.g. queue-operations). Returns one or more Message records otherwise.
 *
 *  We return an array because a single `assistant` event can yield multiple
 *  Messages (an assistant turn often contains a thinking block + text + a
 *  tool_use, all in the same record).
 */
export function parseLine(line: string): Message[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let raw: RawEventBase & Record<string, unknown>;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    // Malformed JSON — could be a partial write while we're tailing.
    // Skip silently; the next read will pick it up once the line completes.
    return [];
  }

  const ts = raw.timestamp ?? new Date().toISOString();
  const uuid = raw.uuid ?? crypto.randomUUID();

  switch (raw.type) {
    case 'queue-operation':
    case 'file-history-snapshot':
    case 'ai-title':
    case 'last-prompt':
    case 'summary':
    case 'system':
      // Internal scaffolding Claude Code writes around real events.
      // Surfacing these as [unknown] pills clutters the timeline.
      return [];

    case 'user': {
      const content = (raw['message'] as { content?: ContentBlock[] | string } | undefined)?.content;
      if (!content) return [];

      // permissionMode lives at the top of certain events (mostly user). We
      // surface it on user-prompt so the tracker can cache it per session.
      const permissionMode = typeof raw['permissionMode'] === 'string'
        ? (raw['permissionMode'] as string)
        : undefined;

      // Claude Code sets isApiErrorMessage: true on the parent event only when
      // the tool_result represents a real API/network/transport failure.
      // Permission denials and ordinary tool errors (bash exit code, etc.) also
      // carry is_error: true on the block, but we don't want those to show
      // as red — they're expected outcomes, not errors. Gate the renderer's
      // "error" treatment on the parent flag.
      const isApiErrorMessage = raw['isApiErrorMessage'] === true;

      // Tool results arrive as `user`-typed events with tool_result blocks
      // in the content array. We split them out from real user prompts.
      if (Array.isArray(content)) {
        const messages: Message[] = [];
        const textBlocks: TextBlock[] = [];

        for (const block of content) {
          if (block.type === 'tool_result') {
            const tr = block as ToolResultBlock;
            messages.push({
              kind: 'tool-result',
              uuid,
              ts,
              toolUseId: tr.tool_use_id,
              output: typeof tr.content === 'string'
                ? tr.content
                : Array.isArray(tr.content)
                  ? tr.content.map(c => c.text ?? '').join('\n')
                  : '',
              isError: tr.is_error === true && isApiErrorMessage,
            });
          } else if (block.type === 'text') {
            textBlocks.push(block as TextBlock);
          }
        }

        if (textBlocks.length > 0) {
          const { ideContext, text } = splitIdeContext(textBlocks);
          if (text) {
            messages.push({
              kind: 'user-prompt', uuid, ts, text, ideContext,
              ...(permissionMode !== undefined ? { permissionMode } : {}),
            });
          } else if (ideContext.length > 0) {
            // Pure IDE-context update with no user prompt — surface as metadata.
            messages.push({
              kind: 'env-metadata', uuid, ts,
              subtype: 'ide-context',
              data: ideContext,
            });
          }
        }
        return messages;
      }

      // String-form content (rare — older sessions): treat as plain prompt.
      return [{
        kind: 'user-prompt', uuid, ts, text: String(content), ideContext: [],
        ...(permissionMode !== undefined ? { permissionMode } : {}),
      }];
    }

    case 'assistant': {
      const message = raw['message'] as {
        content?: ContentBlock[];
        model?: string;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
      } | undefined;
      const content = message?.content;
      if (!Array.isArray(content)) return [];

      const model = message?.model ?? null;
      // Carried only on the LAST text block in the turn — that's the one whose
      // presence terminates the turn and signals "ball is in user's court."
      // We attach it to every text block; the matcher in computeState only
      // cares when the most recent message is assistant-text with stopReason.
      const stopReason = typeof message?.stop_reason === 'string' ? message.stop_reason : undefined;
      const out: Message[] = [];

      // Emit token usage once per assistant turn (not per content block).
      const usage = message?.usage;
      if (usage) {
        out.push({
          kind: 'assistant-usage',
          uuid, ts,
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        });
      }

      for (const block of content) {
        if (block.type === 'text') {
          out.push({
            kind: 'assistant-text', uuid, ts,
            text: (block as TextBlock).text,
            model,
            ...(stopReason !== undefined ? { stopReason } : {}),
          });
        } else if (block.type === 'thinking') {
          out.push({ kind: 'assistant-thinking', uuid, ts, text: (block as ThinkingBlock).thinking });
        } else if (block.type === 'tool_use') {
          const tu = block as ToolUseBlock;
          out.push({ kind: 'tool-call', uuid, ts, tool: tu.name, toolUseId: tu.id, input: tu.input });
        }
      }
      return out;
    }

    case 'result': {
      // End-of-session summary emitted by Claude Code with cumulative cost.
      const cost = typeof raw['cost_usd'] === 'number' ? raw['cost_usd']
        : typeof raw['total_cost_usd'] === 'number' ? raw['total_cost_usd']
        : null;
      if (cost === null) return [];
      return [{ kind: 'session-result', uuid, ts, costUsd: cost }];
    }

    case 'attachment': {
      const att = raw['attachment'] as { type?: string } | undefined;
      return [{
        kind: 'env-metadata', uuid, ts,
        subtype: att?.type ?? 'attachment',
        data: att,
      }];
    }

    default:
      // Forward-compat: everything else surfaces as an unknown record.
      // The renderer can choose whether to display these (probably not by
      // default), and we log them so we know what new event types to add.
      return [{ kind: 'unknown', uuid, ts, raw }];
  }
}

/** Convenience: parse an entire JSONL string. */
export function parseAll(jsonl: string): Message[] {
  return jsonl.split('\n').flatMap(parseLine);
}
