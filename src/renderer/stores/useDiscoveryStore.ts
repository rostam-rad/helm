import { create } from 'zustand';
import type { AdapterId, ValidationFailure } from '@shared/types';

export type ProbeStatus = 'searching' | 'found' | 'not-installed' | 'error';

export interface ProbeRow {
  adapter: AdapterId;
  displayName: string;
  status: ProbeStatus;
  paths: string[];
  hint: string | null;
  sessionCount: number;
  /** Best (most-specific) failure reason across all probed paths for this
   *  adapter. Undefined when status === 'found'. The DiscoveryView uses
   *  this to differentiate "tool not installed" from "found the path
   *  but couldn't read it" / "found but no sessions yet". */
  reason?: ValidationFailure;
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

      // Reason precedence: when an adapter probes multiple paths and they
      // fail differently, surface the *most actionable* one to the user.
      // Permission errors win — they tell the user "we found something,
      // but you need to fix perms." A missing projects dir is more
      // actionable than a path-not-found because it implies the tool is
      // installed but unused. 'unknown' is the catch-all.
      const REASON_RANK: Record<ValidationFailure, number> = {
        'permission-denied': 4,
        'no-projects-dir':   3,
        'no-sessions-yet':   2,
        'not-found':         1,
        'unknown':           0,
      };
      const worstReason = (a: ValidationFailure | undefined, b: ValidationFailure): ValidationFailure =>
        a === undefined ? b : (REASON_RANK[b] > REASON_RANK[a] ? b : a);

      const byAdapter = new Map<AdapterId, { paths: string[]; ok: boolean; reason?: ValidationFailure }>();
      for (const r of results) {
        const cur = byAdapter.get(r.adapter) ?? { paths: [], ok: false };
        cur.paths.push(...r.paths);
        if (r.result.ok) cur.ok = true;
        else cur.reason = worstReason(cur.reason, r.result.reason);
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
          const next: ProbeRow = {
            ...row,
            paths: hit.paths,
            sessionCount: countsByAdapter[row.adapter] ?? 0,
            status: hit.ok ? 'found' as ProbeStatus : 'not-installed' as ProbeStatus,
          };
          if (!hit.ok && hit.reason !== undefined) next.reason = hit.reason;
          return next;
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
