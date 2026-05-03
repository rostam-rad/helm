import clsx from 'clsx';
import type { ToolName } from '@shared/types';

interface Props {
  tool: ToolName;
  className?: string;
}

const GLYPHS: Record<string, string> = {
  Bash:      '⌘',
  Read:      '◉',
  Edit:      '✎',
  Write:     '✎',
  Task:      '◐',
  Glob:      '✱',
  Grep:      '⌕',
  TodoWrite: '☰',
  WebFetch:  '⇣',
  WebSearch: '⇣',
};

export function ToolGlyph({ tool, className }: Props) {
  const glyph = GLYPHS[tool] ?? '·';
  return (
    <span
      aria-hidden
      className={clsx('inline-flex items-center justify-center font-mono leading-none', className)}
      style={{ width: '1em', height: '1em' }}
    >
      {glyph}
    </span>
  );
}
