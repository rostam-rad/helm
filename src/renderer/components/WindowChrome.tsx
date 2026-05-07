import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useSessionsStore, listSessions, type ViewName } from '../stores/useSessionsStore';
import type { SessionMeta } from '@shared/types';
import { fmtRelative } from '../lib/format';

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 10.5A2.5 2.5 0 1 1 8 5.5a2.5 2.5 0 0 1 0 5Zm0-1.5A1 1 0 1 0 8 7a1 1 0 0 0 0 2Z"/>
      <path d="M6.14 1.5a.5.5 0 0 1 .486-.38h2.748a.5.5 0 0 1 .486.38l.3 1.198a5.52 5.52 0 0 1 1.054.609l1.174-.392a.5.5 0 0 1 .596.23l1.374 2.38a.5.5 0 0 1-.1.625l-.924.8a5.567 5.567 0 0 1 0 1.216l.924.8a.5.5 0 0 1 .1.624l-1.374 2.38a.5.5 0 0 1-.596.23l-1.174-.391a5.52 5.52 0 0 1-1.054.608l-.3 1.198a.5.5 0 0 1-.486.38H6.626a.5.5 0 0 1-.486-.38l-.3-1.198a5.52 5.52 0 0 1-1.054-.608l-1.174.391a.5.5 0 0 1-.596-.23L1.642 10.17a.5.5 0 0 1 .1-.625l.924-.8a5.567 5.567 0 0 1 0-1.216l-.924-.8a.5.5 0 0 1-.1-.624l1.374-2.38a.5.5 0 0 1 .596-.23l1.174.392A5.52 5.52 0 0 1 5.84 3.21L6.14 1.5Zm.884 1.12-.27 1.08a.5.5 0 0 1-.358.356 4.52 4.52 0 0 0-1.32.762.5.5 0 0 1-.504.082l-1.054-.352-1.06 1.834.83.719a.5.5 0 0 1 .162.46 4.567 4.567 0 0 0 0 1.518.5.5 0 0 1-.163.46l-.829.72 1.06 1.833 1.054-.351a.5.5 0 0 1 .504.081 4.52 4.52 0 0 0 1.32.762.5.5 0 0 1 .358.357l.27 1.08h2.12l.27-1.08a.5.5 0 0 1 .358-.357 4.52 4.52 0 0 0 1.32-.762.5.5 0 0 1 .504-.08l1.054.35 1.06-1.833-.83-.72a.5.5 0 0 1-.162-.46 4.567 4.567 0 0 0 0-1.517.5.5 0 0 1 .163-.461l.829-.719-1.06-1.834-1.054.352a.5.5 0 0 1-.504-.082 4.52 4.52 0 0 0-1.32-.762.5.5 0 0 1-.358-.356l-.27-1.08H7.024Z"/>
    </svg>
  );
}

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
  const navTabs: { id: ViewName; label: string; suffix?: string }[] = [
    { id: 'discovery', label: 'Discovery' },
    { id: 'sessions',  label: 'Sessions', suffix: String(sessionCount) },
  ];

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-rule bg-bg-2 px-2">
      <div className="flex items-stretch gap-0">
        {navTabs.map(t => (
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
      <button
        onClick={() => onChange('settings')}
        title="Settings"
        className={clsx(
          'ml-1 inline-flex items-center px-2 transition-colors',
          view === 'settings' ? 'text-accent' : 'text-fg-4 hover:text-fg',
        )}
      >
        <GearIcon />
      </button>
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
