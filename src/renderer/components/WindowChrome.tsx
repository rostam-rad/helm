import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useSessionsStore, listSessions, type ViewName } from '../stores/useSessionsStore';
import type { SessionMeta } from '@shared/types';
import { fmtRelative } from '../lib/format';

interface Props {
  children: React.ReactNode;
}

export function WindowChrome({ children }: Props) {
  const view = useSessionsStore(s => s.view);
  const setView = useSessionsStore(s => s.setView);
  const sessionsRecord = useSessionsStore(s => s.sessions);
  const selectedId = useSessionsStore(s => s.selectedId);
  const select = useSessionsStore(s => s.select);
  const openTabs = useSessionsStore(s => s.openTabs);
  const closeTab = useSessionsStore(s => s.closeTab);

  const sessions = useMemo(() => listSessions(sessionsRecord), [sessionsRecord]);
  const lastSyncAt = useMemo(() => {
    let max = '';
    for (const k in sessionsRecord) {
      const v = sessionsRecord[k]?.lastActivityAt ?? '';
      if (v > max) max = v;
    }
    return max || null;
  }, [sessionsRecord]);

  const liveCount = sessions.filter(s => s.state.kind === 'working' || s.state.kind === 'blocked').length;

  // Resolve open tab IDs to their SessionMeta. Skip any that have been
  // discovery-removed since they were pinned.
  const tabs = useMemo(
    () => openTabs.map(id => sessionsRecord[id]).filter((s): s is SessionMeta => !!s),
    [openTabs, sessionsRecord],
  );

  function activateTab(id: string) {
    select(id);
    setView('detail');
  }

  // Re-render once a second so "last sync 2s" stays fresh.
  const [, force] = useState(0);
  useEffect(() => {
    const i = setInterval(() => force(n => n + 1), 1000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="min-h-screen bg-bg-3">
      <div className="flex h-screen flex-col overflow-hidden bg-bg">
        <Titlebar />
        <TabStrip
          view={view}
          onChange={setView}
          sessionCount={sessions.length}
          liveCount={liveCount}
          lastSyncAt={lastSyncAt}
        />
        {tabs.length > 0 && (
          <SessionTabs
            tabs={tabs}
            activeId={view === 'detail' ? selectedId : null}
            onActivate={activateTab}
            onClose={closeTab}
          />
        )}
        <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function Titlebar() {
  // The real macOS traffic lights are provided by Electron's
  // `titleBarStyle: 'hiddenInset'` (see src/main/index.ts). We only
  // render the centered title here to avoid duplicating them.
  return (
    <div className="relative flex h-9 shrink-0 items-center justify-center border-b border-rule bg-bg-2 px-3">
      <span className="text-[12.5px] font-semibold tracking-head text-fg">Helm</span>
    </div>
  );
}

interface TabStripProps {
  view: ViewName;
  onChange: (view: ViewName) => void;
  sessionCount: number;
  liveCount: number;
  lastSyncAt: string | null;
}

function TabStrip({ view, onChange, sessionCount, liveCount, lastSyncAt }: TabStripProps) {
  const tabs: { id: ViewName; label: string; suffix?: string }[] = [
    { id: 'discovery', label: 'Discovery' },
    { id: 'sessions',  label: 'Sessions', suffix: String(sessionCount) },
  ];

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-rule bg-bg-2 px-2">
      <div className="flex items-stretch gap-0">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={clsx(
              'group relative inline-flex items-center gap-2 px-3 text-[12.5px] font-medium tracking-head',
              'border-b-2 transition-colors',
              view === t.id
                ? 'border-accent text-fg'
                : 'border-transparent text-fg-3 hover:text-fg',
            )}
          >
            <span>{t.label}</span>
            {t.suffix && (
              <span className="font-mono text-2xs tracking-caps text-fg-4">{t.suffix}</span>
            )}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 font-mono text-2xs tracking-caps text-fg-4">
        <span className="tnum">{liveCount} LIVE</span>
        <span className="text-fg-4/60">·</span>
        <span className="tnum">last sync {lastSyncAt ? fmtRelative(lastSyncAt) : '—'}</span>
        <span
          className={clsx('block rounded-full', liveCount > 0 ? 'bg-live helm-pulse' : 'bg-fg-4')}
          style={{ width: 7, height: 7 }}
        />
      </div>
    </div>
  );
}

interface SessionTabsProps {
  tabs: SessionMeta[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}

function SessionTabs({ tabs, activeId, onActivate, onClose }: SessionTabsProps) {
  return (
    <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-rule bg-bg-3">
      {tabs.map(t => {
        const active = t.id === activeId;
        const dot =
          t.state.kind === 'working' ? 'bg-live helm-pulse' :
          t.state.kind === 'blocked' ? 'bg-error helm-pulse' :
          t.state.kind === 'awaiting-user' && t.state.freshnessTier === 'fresh' ? 'bg-warn' :
          'bg-fg-4';
        return (
          <div
            key={t.id}
            className={clsx(
              'group relative flex shrink-0 items-stretch border-r border-rule transition-colors',
              active ? 'bg-bg' : 'bg-bg-3 hover:bg-bg-2',
            )}
          >
            <button
              onClick={() => onActivate(t.id)}
              title={t.cwd}
              className={clsx(
                'flex items-center gap-2 pl-3 pr-2 text-[12.5px] font-medium tracking-head max-w-[220px]',
                active ? 'text-fg' : 'text-fg-3 hover:text-fg',
              )}
            >
              <span className={clsx('shrink-0 rounded-full', dot)} style={{ width: 6, height: 6 }} />
              <span className="truncate">{t.projectLabel}</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClose(t.id); }}
              title="Close tab"
              className={clsx(
                'mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center self-center rounded-xs',
                'text-fg-4 hover:text-fg hover:bg-bg-2',
              )}
            >
              ×
            </button>
            {active && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-accent" />}
          </div>
        );
      })}
    </div>
  );
}
