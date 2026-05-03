import { useEffect } from 'react';
import { useSessionsStore } from './stores/useSessionsStore';
import { WindowChrome } from './components/WindowChrome';
import { SessionsView } from './views/SessionsView';
import { SessionDetailView } from './views/SessionDetailView';
import { DiscoveryView } from './views/DiscoveryView';

export function App() {
  const view = useSessionsStore(s => s.view);
  const load = useSessionsStore(s => s.load);
  const setView = useSessionsStore(s => s.setView);
  const loaded = useSessionsStore(s => s.loaded);

  useEffect(() => { void load(); }, [load]);

  // After the first list resolves, send empty installs to Discovery so
  // the user lands somewhere meaningful rather than an empty grid.
  useEffect(() => {
    if (!loaded) return;
    const sessions = useSessionsStore.getState().sessions;
    if (Object.keys(sessions).length === 0) setView('discovery');
  }, [loaded, setView]);

  if (!window.helm) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg p-6 text-center text-fg-3">
        <div>
          <h2 className="text-xl font-semibold tracking-head text-fg mb-1">Helm must run inside Electron</h2>
          <p className="text-sm">
            The IPC bridge (<code className="font-mono">window.helm</code>) isn&rsquo;t available.
            Launch with <code className="font-mono">npm run dev</code> rather than opening
            <code className="font-mono"> localhost:5173</code> in a browser.
          </p>
        </div>
      </div>
    );
  }

  return (
    <WindowChrome>
      {view === 'discovery' && <DiscoveryView />}
      {view === 'sessions'  && <SessionsView />}
      {view === 'detail'    && <SessionDetailView />}
    </WindowChrome>
  );
}
