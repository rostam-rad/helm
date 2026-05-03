import { useEffect } from 'react';
import clsx from 'clsx';
import { useDiscoveryStore, type ProbeRow } from '../stores/useDiscoveryStore';
import { useSessionsStore } from '../stores/useSessionsStore';
import { AdapterMark } from '../components/atoms';
import { HelmMark } from '../components/CompassMark';

export function DiscoveryView() {
  const rows = useDiscoveryStore(s => s.rows);
  const scanning = useDiscoveryStore(s => s.scanning);
  const scan = useDiscoveryStore(s => s.scan);
  const setView = useSessionsStore(s => s.setView);

  useEffect(() => { void scan(); }, [scan]);

  const found = rows.filter(r => r.status === 'found');
  const totalSessions = rows.reduce((sum, r) => sum + r.sessionCount, 0);

  const headerCopy =
    scanning ? { title: 'Looking for your coding agents', sub: 'Helm checks env vars, standard paths, and XDG conventions. Nothing leaves your machine.' } :
    found.length > 0 ? { title: `Found ${found.length} ${found.length === 1 ? 'agent' : 'agents'} on this machine`, sub: `${totalSessions} session${totalSessions === 1 ? '' : 's'} discovered locally. Nothing leaves your machine.` } :
    { title: 'No supported coding agents found', sub: 'Helm searched common paths but didn\'t find any sessions. Add a custom path or skip to demo data.' };

  return (
    <div className="flex h-full items-start justify-center overflow-y-auto bg-bg-2 p-8">
      <div className="w-full max-w-[620px] rounded-md border border-rule bg-bg p-8 shadow-card">
        <div className="flex flex-col items-center text-center">
          <HelmMark size={64} />
          <h1 className="mt-4 text-2xl font-semibold tracking-head2">{headerCopy.title}</h1>
          <p className="mt-1 text-sm text-fg-3">{headerCopy.sub}</p>
        </div>

        <ul className="mt-6 divide-y divide-rule rounded-sm border border-rule">
          {rows.map(r => <ProbeListItem key={r.adapter} row={r} />)}
        </ul>

        <div className="mt-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-xs">
            <button className="text-accent hover:underline">Add a custom path…</button>
            <button className="text-fg-3 hover:text-fg">Search my computer</button>
          </div>
          <div className="flex items-center gap-2">
            {found.length === 0 && !scanning ? (
              <button
                onClick={() => setView('sessions')}
                className="rounded-sm border border-rule px-3 py-1.5 text-xs font-medium text-fg-3 hover:text-fg"
              >
                Skip — show demo data
              </button>
            ) : (
              <button
                onClick={() => setView('sessions')}
                disabled={scanning}
                className={clsx(
                  'rounded-sm px-3 py-1.5 text-xs font-medium',
                  scanning
                    ? 'bg-bg-3 text-fg-4 cursor-not-allowed'
                    : 'bg-accent text-bg hover:opacity-90',
                )}
              >
                Open dashboard →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProbeListItem({ row }: { row: ProbeRow }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <AdapterMark adapterId={row.adapter} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{row.displayName}</div>
        <div className="font-mono text-2xs text-fg-4 truncate">
          {row.paths.length > 0 ? row.paths.join('  ·  ') : row.hint ?? ''}
        </div>
      </div>
      <ProbeStatus row={row} />
    </li>
  );
}

function ProbeStatus({ row }: { row: ProbeRow }) {
  if (row.status === 'searching') {
    return (
      <div className="flex items-center gap-1.5 font-mono text-2xs tracking-caps text-fg-3">
        <Spinner />
        <span>SEARCHING</span>
      </div>
    );
  }
  if (row.status === 'found') {
    return (
      <div className="flex items-center gap-1.5 font-mono text-2xs tracking-caps text-live">
        <span>✓ FOUND</span>
        {row.sessionCount > 0 && <span className="text-fg-4 tnum">· {row.sessionCount}</span>}
      </div>
    );
  }
  if (row.status === 'error') {
    return (
      <div className="font-mono text-2xs tracking-caps text-error">ERROR</div>
    );
  }
  return (
    <div className="font-mono text-2xs tracking-caps text-fg-4">— NOT INSTALLED</div>
  );
}

function Spinner() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" className="animate-spin text-accent">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" fill="none" />
      <path d="M14 8 a6 6 0 0 1 -6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
