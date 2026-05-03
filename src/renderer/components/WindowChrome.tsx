import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import { useSessionsStore, listSessions, type ViewName } from '../stores/useSessionsStore';
import { fmtRelative } from '../lib/format';

interface Props {
  children: React.ReactNode;
}

export function WindowChrome({ children }: Props) {
  const view = useSessionsStore(s => s.view);
  const setView = useSessionsStore(s => s.setView);
  const sessionsRecord = useSessionsStore(s => s.sessions);
  const selectedId = useSessionsStore(s => s.selectedId);

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
  const selected = selectedId ? sessionsRecord[selectedId] ?? null : null;

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
          selectedLabel={selected?.projectLabel ?? null}
          liveCount={liveCount}
          lastSyncAt={lastSyncAt}
        />
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
  selectedLabel: string | null;
  liveCount: number;
  lastSyncAt: string | null;
}

function TabStrip({ view, onChange, sessionCount, selectedLabel, liveCount, lastSyncAt }: TabStripProps) {
  const tabs: { id: ViewName; label: string; suffix?: string; disabled?: boolean }[] = [
    { id: 'discovery', label: 'Discovery' },
    { id: 'sessions',  label: 'Sessions', suffix: String(sessionCount) },
    { id: 'detail',    label: 'Detail',   suffix: selectedLabel ?? '—', disabled: !selectedLabel },
  ];

  return (
    <div className="flex h-10 shrink-0 items-stretch border-b border-rule bg-bg-2 px-2">
      <div className="flex items-stretch gap-0">
        {tabs.map(t => (
          <button
            key={t.id}
            disabled={t.disabled}
            onClick={() => !t.disabled && onChange(t.id)}
            className={clsx(
              'group relative inline-flex items-center gap-2 px-3 text-[12.5px] font-medium tracking-head',
              'border-b-2 transition-colors',
              t.disabled && 'cursor-not-allowed opacity-50',
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
