import clsx from 'clsx';
import { useEffect, useRef } from 'react';
import type { SessionMeta, SessionState } from '@shared/types';
import { AdapterMark } from './atoms';
import { fmtRelative } from '../lib/format';

interface Props {
  sessions: SessionMeta[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function dotClassFor(state: SessionState): string {
  if (state.kind === 'working') return 'bg-live helm-pulse';
  if (state.kind === 'blocked') return 'bg-error helm-pulse';
  if (state.kind === 'awaiting-user' && state.freshnessTier === 'fresh') return 'bg-warn';
  return 'bg-fg-4';
}

export function SessionRail({ sessions, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const idx = sessions.findIndex(s => s.id === selectedId);
      if (idx === -1) return;
      const next = e.key === 'ArrowDown' ? Math.min(idx + 1, sessions.length - 1) : Math.max(idx - 1, 0);
      if (next === idx) return;
      e.preventDefault();
      const target = sessions[next];
      if (target) onSelect(target.id);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessions, selectedId, onSelect]);

  return (
    <div ref={containerRef} className="flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-r border-rule bg-bg-2">
      <div className="sticky top-0 z-10 border-b border-rule bg-bg-2 px-3 py-2 font-mono text-2xs tracking-caps text-fg-4">
        SESSIONS · {sessions.length}
      </div>
      <ul>
        {sessions.map(s => {
          const dot = dotClassFor(s.state);
          const isSelected = s.id === selectedId;
          return (
            <li key={s.id}>
              <button
                onClick={() => onSelect(s.id)}
                className={clsx(
                  'group flex w-full items-start gap-2 border-l-[2px] px-3 py-2 text-left transition-colors',
                  isSelected
                    ? 'border-accent bg-bg'
                    : 'border-transparent hover:bg-bg/60',
                )}
              >
                <AdapterMark adapterId={s.adapter} size={18} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-fg">{s.projectLabel}</span>
                    <span className={clsx('shrink-0 rounded-full', dot)} style={{ width: 6, height: 6 }} />
                  </div>
                  {s.firstUserMessage && (
                    <div
                      className="text-xs text-fg-3"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {s.firstUserMessage}
                    </div>
                  )}
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-2xs text-fg-4 tnum">
                    {s.gitBranch && <span className="truncate">⎇ {s.gitBranch}</span>}
                    {s.model && (
                      <span
                        title={s.model}
                        className={clsx(
                          'inline-flex h-3.5 w-3.5 items-center justify-center rounded-xs font-semibold',
                          s.modelClass === 'local' ? 'bg-local-soft text-local' : 'bg-cloud-soft text-cloud',
                        )}
                      >
                        {s.modelClass === 'local' ? 'L' : 'C'}
                      </span>
                    )}
                    <span className="ml-auto">{fmtRelative(s.lastActivityAt)}</span>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
