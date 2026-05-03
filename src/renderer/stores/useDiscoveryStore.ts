import { create } from 'zustand';
import type { AdapterId } from '@shared/types';

export type ProbeStatus = 'searching' | 'found' | 'not-installed' | 'error';

export interface ProbeRow {
  adapter: AdapterId;
  displayName: string;
  status: ProbeStatus;
  paths: string[];
  hint: string | null;
  sessionCount: number;
}

interface DiscoveryState {
  rows: ProbeRow[];
  lastSyncAt: string | null;
  scanning: boolean;
  scan: () => Promise<void>;
}

const ADAPTER_ORDER: AdapterId[] = ['claude-code', 'codex', 'aider', 'cline'];

const HINTS: Record<AdapterId, string> = {
  'claude-code': '~/.claude/  ·  $CLAUDE_CONFIG_DIR  ·  XDG',
  codex:         'not yet implemented',
  aider:         'not yet implemented',
  cline:         'not yet implemented',
};

const NAMES: Record<AdapterId, string> = {
  'claude-code': 'Claude Code',
  codex:         'OpenAI Codex',
  aider:         'Aider',
  cline:         'Cline',
};

export const useDiscoveryStore = create<DiscoveryState>((set) => ({
  rows: ADAPTER_ORDER.map(id => ({
    adapter: id,
    displayName: NAMES[id],
    status: 'searching' as ProbeStatus,
    paths: [],
    hint: HINTS[id],
    sessionCount: 0,
  })),
  lastSyncAt: null,
  scanning: false,

  async scan() {
    if (!window.helm) return;
    set({ scanning: true });

    // Optimistic: every adapter starts searching while the rescan runs.
    set(state => ({
      rows: state.rows.map(r => ({ ...r, status: 'searching' as ProbeStatus })),
    }));

    try {
      const results = await window.helm.invoke('discovery:rescan');
      const list = await window.helm.invoke('sessions:list').catch(() => []);
      const countsByAdapter: Record<string, number> = {};
      for (const s of list) countsByAdapter[s.adapter] = (countsByAdapter[s.adapter] ?? 0) + 1;

      const byAdapter = new Map<AdapterId, { paths: string[]; ok: boolean; reason?: string }>();
      for (const r of results) {
        const cur = byAdapter.get(r.adapter) ?? { paths: [], ok: false };
        cur.paths.push(...r.paths);
        if (r.result.ok) cur.ok = true;
        else cur.reason = r.result.reason;
        byAdapter.set(r.adapter, cur);
      }

      set(state => ({
        scanning: false,
        lastSyncAt: new Date().toISOString(),
        rows: state.rows.map(row => {
          const hit = byAdapter.get(row.adapter);
          if (!hit) {
            return { ...row, status: 'not-installed' as ProbeStatus, paths: [], sessionCount: 0 };
          }
          return {
            ...row,
            paths: hit.paths,
            sessionCount: countsByAdapter[row.adapter] ?? 0,
            status: hit.ok ? 'found' as ProbeStatus : 'not-installed' as ProbeStatus,
          };
        }),
      }));
    } catch {
      set(state => ({
        scanning: false,
        rows: state.rows.map(r => ({ ...r, status: 'error' as ProbeStatus })),
      }));
    }
  },
}));
