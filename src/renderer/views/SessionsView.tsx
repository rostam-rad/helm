import { useEffect, useMemo, useRef } from 'react';
import clsx from 'clsx';
import {
  applyFilter,
  listSessions,
  summarise,
  useSessionsStore,
  type FilterId,
} from '../stores/useSessionsStore';
import { SessionCard } from '../components/SessionCard';
import { AdapterMark } from '../components/atoms';
import { fmtCost, fmtTokens } from '../lib/format';
import type { AdapterId } from '@shared/types';

const ADAPTERS: AdapterId[] = ['claude-code', 'codex', 'aider', 'cline'];

export function SessionsView() {
  const sessionsRecord = useSessionsStore(s => s.sessions);
  const sessions = useMemo(() => listSessions(sessionsRecord), [sessionsRecord]);
  const filter = useSessionsStore(s => s.filter);
  const setFilter = useSessionsStore(s => s.setFilter);
  const query = useSessionsStore(s => s.searchQuery);
  const setQuery = useSessionsStore(s => s.setSearchQuery);
  const select = useSessionsStore(s => s.select);
  const setView = useSessionsStore(s => s.setView);
  const openTab = useSessionsStore(s => s.openTab);
  const loaded = useSessionsStore(s => s.loaded);

  const filtered = useMemo(() => applyFilter(sessions, filter, query), [sessions, filter, query]);
  const summary = useMemo(() => summarise(sessions), [sessions]);

  const counts = useMemo(() => ({
    all: sessions.length,
    active: summary.active,
    cloud: summary.cloud,
    local: summary.local,
    blocked: sessions.filter(s => s.state.kind === 'blocked').length,
  }), [sessions, summary]);

  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function openSession(id: string) {
    openTab(id);
    select(id);
    setView('detail');
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SummaryStrip summary={summary} />

      <div className="flex shrink-0 items-center gap-2 border-b border-rule px-4 py-2">
        <div className="flex items-center gap-1">
          {(['all', 'active', 'cloud', 'local', 'blocked'] as FilterId[]).map(id => (
            <FilterChip key={id} id={id} count={counts[id]} active={filter === id} onClick={() => setFilter(id)} />
          ))}
        </div>
        <div className="flex-1" />
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-xs text-fg-4">⌕</span>
          <input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="filter by project, model, branch…"
            className={clsx(
              'h-7 w-72 rounded-sm border border-rule bg-bg pl-6 pr-12 text-xs',
              'placeholder:text-fg-4 focus:border-accent focus:outline-none',
            )}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 font-mono text-2xs text-fg-4">
            <kbd className="rounded-xs border border-rule px-1 py-px tracking-caps">⌘</kbd>
            <kbd className="rounded-xs border border-rule px-1 py-px tracking-caps">K</kbd>
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!loaded ? (
          <div className="flex h-full items-center justify-center text-fg-3 text-sm">Loading sessions…</div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-fg-3 text-sm">
            <div>
              <div className="font-mono text-2xs tracking-caps text-fg-4 mb-1">EMPTY</div>
              {sessions.length === 0
                ? 'No sessions discovered yet.'
                : 'No sessions match this filter.'}
            </div>
          </div>
        ) : (
          <div
            className="grid gap-[14px]"
            // 440px minimum: at narrow window widths (<880px) we collapse to a
            // single comfortable card per row instead of two cramped columns,
            // and the stats footer (msg · tokens · cost · time) doesn't truncate.
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(440px, 1fr))' }}
          >
            {filtered.map(s => (
              <SessionCard key={s.id} session={s} onOpen={openSession} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryStrip({ summary }: { summary: ReturnType<typeof summarise> }) {
  const cloudPct = summary.total ? Math.round((summary.cloud / summary.total) * 100) : 0;
  const localPct = summary.total ? Math.round((summary.local / summary.total) * 100) : 0;
  const freePct  = summary.total ? Math.round((summary.free  / summary.total) * 100) : 0;

  return (
    <div
      className="grid shrink-0 divide-x divide-rule border-b border-rule bg-bg-2"
      style={{ gridTemplateColumns: '1fr 1fr 1.6fr 1.2fr' }}
    >
      <Cell label="active">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-semibold tracking-head2 tnum">{summary.active}</span>
          <span className="font-mono text-xs text-fg-4 tnum">/ {summary.total}</span>
        </div>
      </Cell>

      <Cell label="today · cloud spend">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-head2 tnum">{fmtCost(summary.totalCost)}</span>
          <span className="font-mono text-xs text-fg-4 tnum">{fmtTokens(summary.totalTokens)}</span>
        </div>
      </Cell>

      <Cell label="cloud / local mix">
        <div>
          <div className="flex h-2 overflow-hidden rounded-xs bg-bg-3">
            <div className="h-full bg-cloud" style={{ width: `${cloudPct}%` }} />
            <div className="h-full bg-local" style={{ width: `${localPct}%` }} />
          </div>
          <div className="mt-1 font-mono text-2xs tracking-caps text-fg-3 tnum">
            {summary.cloud} cloud · {summary.local} local · {freePct}% free
          </div>
        </div>
      </Cell>

      <Cell label="adapters">
        <div className="flex items-center gap-3">
          {ADAPTERS.map(a => {
            const n = summary.byAdapter[a] ?? 0;
            return (
              <div key={a} className={clsx('flex items-center gap-1.5', n === 0 && 'opacity-40')}>
                <AdapterMark adapterId={a} size={18} />
                <span className="font-mono text-xs tnum">{n}</span>
              </div>
            );
          })}
        </div>
      </Cell>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center gap-1 px-4 py-3">
      <div className="font-mono text-2xs tracking-caps text-fg-4">{label.toUpperCase()}</div>
      {children}
    </div>
  );
}

function FilterChip({ id, count, active, onClick }: { id: FilterId; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'bg-fg text-bg'
          : 'bg-bg-2 text-fg-3 hover:text-fg border border-rule',
      )}
    >
      <span className="capitalize">{id}</span>
      <span className={clsx('font-mono text-2xs tracking-caps tnum', active ? 'text-bg/70' : 'text-fg-4')}>
        {count}
      </span>
    </button>
  );
}
