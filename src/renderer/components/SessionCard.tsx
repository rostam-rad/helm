import clsx from 'clsx';
import type { SessionMeta } from '@shared/types';
import { AdapterMark, ModelBadge, StatusPill, ToolGlyph } from './atoms';
import { fmtCost, fmtTokens, fmtRelative } from '../lib/format';

interface Props {
  session: SessionMeta;
  onOpen: (id: string) => void;
}

export function SessionCard({ session, onOpen }: Props) {
  const state = session.state;
  const isStaleAwaiting = state.kind === 'awaiting-user' && state.freshnessTier === 'stale';
  const stripe =
    state.kind === 'working' ? 'border-l-live' :
    state.kind === 'blocked' ? 'border-l-error' :
    state.kind === 'awaiting-user' && state.freshnessTier === 'fresh' ? 'border-l-warn' :
    'border-l-transparent';

  return (
    <button
      type="button"
      onClick={() => onOpen(session.id)}
      className={clsx(
        'group flex flex-col items-stretch gap-2 rounded-md border border-rule bg-bg-2 p-3 text-left',
        'border-l-[2px] transition-colors hover:border-rule-2 hover:shadow-card',
        stripe,
        isStaleAwaiting && 'opacity-[0.92]',
      )}
    >
      <div className="flex items-start gap-2">
        <AdapterMark adapterId={session.adapter} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-md font-semibold tracking-head">{session.projectLabel}</span>
          </div>
          {session.gitBranch && (
            <div className="font-mono text-xs text-fg-3 truncate">⎇ {session.gitBranch}</div>
          )}
        </div>
        <StatusPill state={state} />
      </div>

      {session.firstUserMessage && (
        <p
          className="text-sm text-fg-2"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            textWrap: 'pretty' as React.CSSProperties['textWrap'],
          }}
        >
          {session.firstUserMessage}
        </p>
      )}

      <NowStrip session={session} />

      <div className="mt-1 flex items-center justify-between gap-2">
        <ModelBadge model={session.model} modelClass={session.modelClass} provider={session.modelProvider} compact />
        <div className="flex items-center gap-2 font-mono text-2xs tracking-caps text-fg-3 tnum">
          <span>{session.messageCount} msg</span>
          <span className="text-fg-4/60">·</span>
          <span>{fmtTokens(session.totalTokens)}</span>
          <span className="text-fg-4/60">·</span>
          <span>{fmtCost(session.totalCostUsd)}</span>
          <span className="text-fg-4/60">·</span>
          <span className="text-fg-4">{fmtRelative(session.lastActivityAt)}</span>
        </div>
      </div>
    </button>
  );
}

function NowStrip({ session }: { session: SessionMeta }) {
  // SessionMeta doesn't expose "currently running tool" yet. Until it
  // does, just show a one-line hint when something is in flight, otherwise
  // the last-activity nudge.
  const inFlight = session.state.kind === 'working' || session.state.kind === 'blocked';
  return (
    <div className="rounded-xs border border-rule bg-bg px-2 py-1.5">
      {inFlight ? (
        <div className="flex items-center gap-2 font-mono text-xs text-fg-3">
          <ToolGlyph tool="Task" className="text-accent" />
          <span className="truncate">
            {session.state.kind === 'blocked' ? 'needs your input…' : 'awaiting next event…'}
          </span>
        </div>
      ) : (
        <div className="text-xs text-fg-3 truncate">
          last activity {fmtRelative(session.lastActivityAt)} · {session.cwd}
        </div>
      )}
    </div>
  );
}
