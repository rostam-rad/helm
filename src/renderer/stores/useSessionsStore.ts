import { create } from 'zustand';
import type { SessionMeta, SessionState } from '@shared/types';

export type ViewName = 'discovery' | 'sessions' | 'detail';
export type FilterId = 'all' | 'active' | 'cloud' | 'local' | 'blocked';

/** A session is "active" (in-flight or recently quiet but still warm) when
 *  it isn't a stale awaiting-user. Replaces the old `isActive` boolean. */
function isActiveState(state: SessionState): boolean {
  if (state.kind === 'working' || state.kind === 'blocked') return true;
  return state.freshnessTier !== 'stale';
}

interface SessionsState {
  sessions: Record<string, SessionMeta>;
  selectedId: string | null;
  view: ViewName;
  filter: FilterId;
  searchQuery: string;
  loaded: boolean;

  // Actions
  load: () => Promise<void>;
  select: (id: string | null) => void;
  setView: (view: ViewName) => void;
  setFilter: (filter: FilterId) => void;
  setSearchQuery: (q: string) => void;
  updateMeta: (meta: SessionMeta) => void;
}

let subscribed = false;

export const useSessionsStore = create<SessionsState>((set, get) => ({
  sessions: {},
  selectedId: null,
  view: 'sessions',
  filter: 'all',
  searchQuery: '',
  loaded: false,

  async load() {
    if (!window.helm) return;
    const list = await window.helm.invoke('sessions:list');
    const sessions: Record<string, SessionMeta> = {};
    for (const s of list) sessions[s.id] = s;
    set({ sessions, loaded: true });

    if (subscribed) return;
    subscribed = true;

    // Live meta updates: replace the record in place so card-level
    // memoisation doesn't churn the rest of the grid.
    window.helm.on('sessions:meta-changed', ({ meta }) => {
      set(state => ({ sessions: { ...state.sessions, [meta.id]: meta } }));
    });

    // A discovery sweep may have added/removed sessions — refresh the
    // list rather than diff event-by-event.
    window.helm.on('discovery:changed', () => {
      void get().load();
    });
  },

  select(id) { set({ selectedId: id }); },
  setView(view) { set({ view }); },
  setFilter(filter) { set({ filter }); },
  setSearchQuery(searchQuery) { set({ searchQuery }); },
  updateMeta(meta) { set(state => ({ sessions: { ...state.sessions, [meta.id]: meta } })); },
}));

// ----- selectors (called outside the store to keep state shape lean) -----

/**
 * Take the raw record (not the whole state) and return a sorted list.
 * Components should call this through `useMemo` keyed on the record
 * reference, otherwise React's `useSyncExternalStore` will see a new
 * array every render and loop.
 */
export function listSessions(sessions: Record<string, SessionMeta>): SessionMeta[] {
  return Object.values(sessions).sort((a, b) =>
    b.lastActivityAt.localeCompare(a.lastActivityAt),
  );
}

export function applyFilter(sessions: SessionMeta[], filter: FilterId, query: string): SessionMeta[] {
  const q = query.trim().toLowerCase();
  return sessions.filter(s => {
    if (filter === 'active' && !isActiveState(s.state)) return false;
    if (filter === 'cloud' && s.modelClass !== 'cloud') return false;
    if (filter === 'local' && s.modelClass !== 'local') return false;
    if (filter === 'blocked' && s.state.kind !== 'blocked') return false;
    if (!q) return true;
    return (
      s.projectLabel.toLowerCase().includes(q) ||
      (s.model ?? '').toLowerCase().includes(q) ||
      (s.gitBranch ?? '').toLowerCase().includes(q) ||
      s.cwd.toLowerCase().includes(q)
    );
  });
}

export function summarise(sessions: SessionMeta[]) {
  let active = 0, cloud = 0, local = 0, free = 0, totalCost = 0, totalTokens = 0;
  const byAdapter: Record<string, number> = {};
  for (const s of sessions) {
    if (isActiveState(s.state)) active++;
    if (s.modelClass === 'cloud') cloud++;
    if (s.modelClass === 'local') local++;
    if (s.totalCostUsd <= 0) free++;
    totalCost += s.totalCostUsd;
    totalTokens += s.totalTokens;
    byAdapter[s.adapter] = (byAdapter[s.adapter] ?? 0) + 1;
  }
  return { total: sessions.length, active, cloud, local, free, totalCost, totalTokens, byAdapter };
}
