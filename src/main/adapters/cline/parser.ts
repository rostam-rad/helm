/**
 * Cline conversation parser.
 *
 * Cline stores conversations in api_conversation_history.json as a flat
 * array of {role, content[]} messages — similar to the raw Anthropic API
 * format. Content blocks are text, tool_use, and tool_result types.
 *
 * We map these to Helm's Message union. Tool calls are surfaced as generic
 * tool-call records; tool results as tool-result records. In v0.3 we don't
 * attempt Cline-specific tool rendering (different tool names, different
 * input shapes) — that's v0.4.
 */

import type { Message } from '../../../shared/types';

interface ClineTextBlock    { type: 'text'; text: string; usage?: { input_tokens?: number; output_tokens?: number } }
interface ClineToolUseBlock { type: 'tool_use'; id: string; name: string; input: unknown }
interface ClineToolResultBlock { type: 'tool_result'; tool_use_id: string; content: string | ClineTextBlock[] }
type ClineContentBlock = ClineTextBlock | ClineToolUseBlock | ClineToolResultBlock | { type: string };

interface ClineMessage {
  role: 'user' | 'assistant';
  content: ClineContentBlock[] | string;
}

export function parseClineHistory(raw: unknown): Message[] {
  if (!Array.isArray(raw)) return [];
  const messages: Message[] = [];
  let msgIndex = 0;

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const msg = item as ClineMessage;
    const uuid = `cline-${msgIndex++}`;
    const ts = new Date().toISOString(); // Cline history has no per-message ts

    const content: ClineContentBlock[] = Array.isArray(msg.content)
      ? msg.content as ClineContentBlock[]
      : [{ type: 'text', text: String(msg.content) }];

    if (msg.role === 'user') {
      for (const block of content) {
        if (block.type === 'tool_result') {
          const tr = block as ClineToolResultBlock;
          const output = typeof tr.content === 'string'
            ? tr.content
            : Array.isArray(tr.content)
              ? tr.content.map(b => ('text' in b ? b.text : '')).join('\n')
              : '';
          messages.push({
            kind: 'tool-result',
            uuid,
            ts,
            toolUseId: tr.tool_use_id,
            output,
            isError: false,
          });
        } else if (block.type === 'text') {
          const text = (block as ClineTextBlock).text.trim();
          // Strip <task> wrapper that Cline injects for the first message.
          const cleaned = text.replace(/^<task>\n?/, '').replace(/\n?<\/task>$/, '').trim();
          if (cleaned) {
            messages.push({ kind: 'user-prompt', uuid, ts, text: cleaned, ideContext: [] });
          }
        }
      }
    } else if (msg.role === 'assistant') {
      let inputTokens = 0;
      let outputTokens = 0;
      for (const block of content) {
        if (block.type === 'text') {
          const tb = block as ClineTextBlock;
          if (tb.usage) {
            inputTokens += tb.usage.input_tokens ?? 0;
            outputTokens += tb.usage.output_tokens ?? 0;
          }
          if (tb.text.trim()) {
            messages.push({ kind: 'assistant-text', uuid, ts, text: tb.text, model: null });
          }
        } else if (block.type === 'tool_use') {
          const tu = block as ClineToolUseBlock;
          messages.push({
            kind: 'tool-call',
            uuid,
            ts,
            tool: tu.name,
            toolUseId: tu.id,
            input: tu.input,
          });
        }
      }
      if (inputTokens > 0 || outputTokens > 0) {
        messages.push({
          kind: 'assistant-usage',
          uuid: `${uuid}-usage`,
          ts,
          inputTokens,
          outputTokens,
          cacheReadTokens: 0,
        });
      }
    }
  }

  return messages;
}
