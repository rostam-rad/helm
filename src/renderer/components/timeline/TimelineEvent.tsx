import clsx from 'clsx';
import { useState } from 'react';
import type { Message } from '@shared/types';
import { ToolGlyph } from '../atoms';
import { fmtClock } from '../../lib/format';

type ToolCall = Extract<Message, { kind: 'tool-call' }>;
type ToolResult = Extract<Message, { kind: 'tool-result' }>;

export interface TimelineRow {
  message: Message;
  // Pre-resolved tool-result for this tool-call, or undefined.
  pairedResult?: ToolResult;
  // For user-prompt rows: the model that produced the immediately following
  // assistant turn, if any. Lets the UI label each prompt with the model
  // that actually answered it (especially useful when the user swaps models
  // mid-session). Not set on non-user-prompt rows.
  respondedBy?: string;
}

interface Props {
  row: TimelineRow;
  isLast: boolean;
}

/**
 * One row of the timeline grid: timestamp on the left, vertical rail
 * with a node, then the body. The grid is centered to max-width 880px
 * by the parent.
 */
export function TimelineEvent({ row, isLast }: Props) {
  const { message } = row;
  return (
    <div
      className="grid items-start gap-x-[14px] helm-event-in"
      style={{ gridTemplateColumns: '56px 1fr' }}
    >
      <div className="text-right font-mono text-2xs text-fg-4 tnum pt-1">{fmtClock(message.ts)}</div>
      <div className="relative pb-3">
        <RailNode message={message} isLast={isLast} />
        <div className="pl-7">
          <Body row={row} />
        </div>
      </div>
    </div>
  );
}

function RailNode({ message, isLast }: { message: Message; isLast: boolean }) {
  const color =
    message.kind === 'user-prompt' ? 'bg-accent' :
    message.kind === 'tool-call' ? 'bg-accent' :
    message.kind === 'tool-result' && (message as ToolResult).isError ? 'bg-error' :
    'bg-fg-4';

  return (
    <>
      {/* Vertical rail */}
      <div
        className={clsx('absolute top-0 w-px bg-rule', isLast ? 'h-3' : 'bottom-0')}
        style={{ left: 8 }}
      />
      <div
        className={clsx('absolute top-1.5 rounded-full border border-bg', color)}
        style={{ left: 4, width: 9, height: 9 }}
      />
    </>
  );
}

function Body({ row }: { row: TimelineRow }) {
  const m = row.message;
  switch (m.kind) {
    case 'user-prompt':       return <UserPrompt m={m} {...(row.respondedBy ? { respondedBy: row.respondedBy } : {})} />;
    case 'assistant-text':    return <AssistantText m={m} />;
    case 'assistant-thinking':return <Thinking m={m} />;
    case 'tool-call':         return <ToolCallBlock call={m} {...(row.pairedResult ? { result: row.pairedResult } : {})} />;
    case 'tool-result':       return null; // Rendered inline with its tool-call.
    case 'env-metadata':      return <EnvPill subtype={m.subtype} />;
    case 'unknown':           return <EnvPill subtype="unknown" />;
  }
}

// -------- bubbles --------

function UserPrompt({ m, respondedBy }: { m: Extract<Message, { kind: 'user-prompt' }>; respondedBy?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline gap-2">
        <span className="font-mono text-2xs tracking-caps text-fg-4">YOU</span>
        {respondedBy && (
          <span className="font-mono text-2xs text-fg-4" title="Model that answered this prompt">
            → {respondedBy}
          </span>
        )}
      </div>
      {m.ideContext.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {m.ideContext.map((c, i) => (
            <span key={i} className="rounded-xs bg-bg-3 px-1.5 py-0.5 font-mono text-2xs text-fg-3">
              {c.length > 60 ? `${c.slice(0, 60)}…` : c}
            </span>
          ))}
        </div>
      )}
      <div
        className="rounded-sm px-2.5 py-1.5 text-base whitespace-pre-wrap"
        style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent-ink)' }}
      >
        {m.text}
      </div>
    </div>
  );
}

function AssistantText({ m }: { m: Extract<Message, { kind: 'assistant-text' }> }) {
  return (
    <div>
      <div className="font-mono text-2xs tracking-caps text-fg-4 mb-1">ASSISTANT</div>
      <div className="whitespace-pre-wrap text-base text-fg" style={{ lineHeight: 1.55 }}>
        {m.text}
      </div>
      {m.model && <div className="mt-1 font-mono text-2xs text-fg-4">{m.model}</div>}
    </div>
  );
}

function Thinking({ m }: { m: Extract<Message, { kind: 'assistant-thinking' }> }) {
  const [open, setOpen] = useState(false);
  const text = m.text ?? '';
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  const truncated = text.length > 140;

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start gap-2 rounded-xs border border-rule bg-bg-2 px-2 py-1 text-left hover:border-rule-2"
      >
        <span className="mt-px font-mono text-2xs tracking-caps text-fg-4">{open ? '▾' : '▸'}</span>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-2xs tracking-caps text-fg-4">
            thinking · {text.length} chars
          </div>
          {!open && text && (
            <div className="mt-0.5 truncate text-xs italic text-fg-3">
              {preview}{truncated ? '…' : ''}
            </div>
          )}
        </div>
      </button>
      {open && text && (
        <div className="mt-1 border-l-2 border-rule-2 pl-3 italic text-sm text-fg-2 whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

function ToolCallBlock({ call, result }: { call: ToolCall; result?: ToolResult }) {
  const [open, setOpen] = useState(false);
  const summary = summariseToolInput(call);

  return (
    <div className="rounded-sm border border-rule bg-bg-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <ToolGlyph tool={call.tool} className="text-accent text-base" />
        <span className="font-mono text-xs font-medium tracking-tightish">{call.tool}</span>
        <span className="truncate font-mono text-xs text-fg-3">{summary}</span>
        <span className="ml-auto font-mono text-2xs text-fg-4">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border-t border-rule p-2 space-y-2">
          <ToolInputView call={call} />
          {result && <ToolResultView result={result} />}
        </div>
      )}
      {!open && result?.isError && (
        <div className="border-t border-error/30 px-2 py-1 font-mono text-2xs text-error tracking-caps">
          ERRORED · click to expand
        </div>
      )}
    </div>
  );
}

interface TodoItem { content: string; activeForm?: string; status: 'pending' | 'in_progress' | 'completed' | string }

function readTodos(call: ToolCall): TodoItem[] | null {
  const input = call.input as Record<string, unknown> | null;
  if (!input || !Array.isArray(input.todos)) return null;
  return (input.todos as unknown[]).filter(
    (t): t is TodoItem => !!t && typeof t === 'object' && typeof (t as TodoItem).content === 'string',
  );
}

function summariseToolInput(call: ToolCall): string {
  const input = call.input as Record<string, unknown> | null;
  if (!input || typeof input !== 'object') return '';
  if (call.tool === 'Bash') {
    const desc = typeof input.description === 'string' ? input.description : '';
    const cmd = typeof input.command === 'string' ? input.command : '';
    return desc || cmd;
  }
  if (call.tool === 'Read') {
    const path = typeof input.file_path === 'string' ? input.file_path : '';
    const limit = typeof input.limit === 'number' ? ` · ${input.limit} lines` : '';
    return `${path}${limit}`;
  }
  if (call.tool === 'Edit' || call.tool === 'Write') {
    return typeof input.file_path === 'string' ? input.file_path : '';
  }
  if (call.tool === 'TodoWrite') {
    const todos = readTodos(call) ?? [];
    if (todos.length === 0) return '';
    const done = todos.filter(t => t.status === 'completed').length;
    const inflight = todos.filter(t => t.status === 'in_progress').length;
    const active = todos.find(t => t.status === 'in_progress');
    const tail = active ? ` · ${active.activeForm ?? active.content}` : '';
    return `${done}/${todos.length} done${inflight > 0 ? ` · ${inflight} active` : ''}${tail}`;
  }
  return '';
}

function ToolInputView({ call }: { call: ToolCall }) {
  const input = call.input as Record<string, unknown> | null;
  if (!input) return null;

  if (call.tool === 'Bash' && typeof input.command === 'string') {
    return (
      <pre className="overflow-x-auto rounded-xs bg-bg-3 px-2 py-1.5 font-mono text-xs text-fg whitespace-pre-wrap">
        <span className="text-fg-4">$ </span>{input.command}
      </pre>
    );
  }

  if ((call.tool === 'Edit' || call.tool === 'Write') && typeof input.new_string === 'string') {
    const oldStr = typeof input.old_string === 'string' ? input.old_string : '';
    return <DiffView oldStr={oldStr} newStr={input.new_string} />;
  }

  if (call.tool === 'TodoWrite') {
    const todos = readTodos(call);
    if (todos && todos.length > 0) return <TodoListView todos={todos} />;
  }

  return (
    <pre className="overflow-x-auto rounded-xs bg-bg-3 px-2 py-1.5 font-mono text-xs text-fg-2 whitespace-pre-wrap">
      {JSON.stringify(input, null, 2)}
    </pre>
  );
}

function TodoListView({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="space-y-1">
      {todos.map((t, i) => {
        const isDone = t.status === 'completed';
        const isActive = t.status === 'in_progress';
        const marker = isDone ? '✓' : isActive ? '◐' : '○';
        const label = isActive && t.activeForm ? t.activeForm : t.content;
        return (
          <li
            key={i}
            className={clsx(
              'flex items-start gap-2 rounded-xs px-2 py-1 text-xs',
              isActive && 'bg-live-soft/40',
              isDone && 'text-fg-4',
            )}
          >
            <span
              className={clsx(
                'mt-px shrink-0 font-mono text-2xs',
                isActive ? 'text-live' : isDone ? 'text-fg-4' : 'text-fg-3',
              )}
              style={{ width: 12, textAlign: 'center' }}
            >
              {marker}
            </span>
            <span className={clsx('min-w-0 flex-1', isDone && 'line-through decoration-fg-4/60')}>
              {label}
            </span>
            {isActive && (
              <span className="shrink-0 font-mono text-2xs tracking-caps text-live">ACTIVE</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const oldLines = oldStr.split('\n');
  const newLines = newStr.split('\n');
  return (
    <div
      className="overflow-auto rounded-xs border border-rule font-mono text-[11.5px] leading-snug"
      style={{ maxHeight: 360 }}
    >
      {oldLines.map((line, i) => (
        <div key={`o-${i}`} className="flex gap-2 px-2 py-px" style={{ backgroundColor: 'color-mix(in oklch, var(--error) 6%, transparent)' }}>
          <span className="select-none text-error">-</span>
          <span className="whitespace-pre">{line}</span>
        </div>
      ))}
      {newLines.map((line, i) => (
        <div key={`n-${i}`} className="flex gap-2 px-2 py-px" style={{ backgroundColor: 'color-mix(in oklch, var(--live) 8%, transparent)' }}>
          <span className="select-none text-live">+</span>
          <span className="whitespace-pre">{line}</span>
        </div>
      ))}
    </div>
  );
}

function ToolResultView({ result }: { result: ToolResult }) {
  const [showAll, setShowAll] = useState(false);
  const lines = result.output.split('\n');
  const truncated = !showAll && lines.length > 8;
  const visible = truncated ? lines.slice(0, 8) : lines;
  return (
    <div className={clsx('rounded-xs border', result.isError ? 'border-error/40' : 'border-rule')}>
      <pre
        className={clsx(
          'overflow-x-auto px-2 py-1.5 font-mono text-xs whitespace-pre-wrap',
          result.isError ? 'text-error' : 'text-fg-2',
        )}
      >
        {visible.join('\n')}
      </pre>
      {truncated && (
        <button
          onClick={() => setShowAll(true)}
          className="block w-full border-t border-rule px-2 py-1 text-left font-mono text-2xs text-accent tracking-caps"
        >
          show {lines.length - 8} more lines
        </button>
      )}
    </div>
  );
}

function EnvPill({ subtype }: { subtype: string }) {
  return (
    <span
      className="inline-block rounded-xs border border-dashed border-rule px-1.5 py-0.5 font-mono text-2xs text-fg-4"
      style={{ fontSize: 10 }}
    >
      [{subtype}]
    </span>
  );
}
