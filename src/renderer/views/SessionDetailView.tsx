import { useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import clsx from 'clsx';
import type { Message, SessionMeta } from '@shared/types';
import { listSessions, useSessionsStore } from '../stores/useSessionsStore';
import { useTimelineStore } from '../stores/useTimelineStore';
import { SessionRail } from '../components/SessionRail';
import { AdapterMark, ModelBadge, StatusPill } from '../components/atoms';
import { TimelineEvent, type TimelineRow } from '../components/timeline/TimelineEvent';
import { fmtCost, fmtDuration, fmtTokens } from '../lib/format';
import { useNow } from '../lib/useNow';
import { classifyModel } from '@shared/model-classification';

const VIRTUALIZE_THRESHOLD = 200;

export function SessionDetailView() {
  const sessionsRecord = useSessionsStore(s => s.sessions);
  const sessions = useMemo(() => listSessions(sessionsRecord), [sessionsRecord]);
  const selectedId = useSessionsStore(s => s.selectedId);
  const select = useSessionsStore(s => s.select);
  const setView = useSessionsStore(s => s.setView);
  const openTab = useSessionsStore(s => s.openTab);

  // Pin into the tab strip whenever the user navigates to a session
  // (from the rail, arrow keys, or auto-select on first load).
  function selectAndPin(id: string) {
    openTab(id);
    select(id);
  }

  const session = useMemo(() => sessions.find(s => s.id === selectedId) ?? null, [sessions, selectedId]);

  // Auto-pick the most recent session if none selected.
  useEffect(() => {
    if (!selectedId && sessions.length > 0) {
      const first = sessions[0];
      if (first) selectAndPin(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, sessions]);

  // Esc returns to grid.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setView('sessions');
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);

  const [railOpen, setRailOpen] = useState(true);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-fg-3 text-sm">
        Pick a session from the rail to view its timeline.
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {railOpen && <SessionRail sessions={sessions} selectedId={session.id} onSelect={selectAndPin} />}
      <DetailPane session={session} railOpen={railOpen} onToggleRail={() => setRailOpen(o => !o)} />
    </div>
  );
}

function DetailPane({ session, railOpen, onToggleRail }: { session: SessionMeta; railOpen: boolean; onToggleRail: () => void }) {
  const open = useTimelineStore(s => s.open);
  const close = useTimelineStore(s => s.close);
  const slice = useTimelineStore(s => s.bySession[session.id]);
  const setView = useSessionsStore(s => s.setView);

  // "Active" for the live-tail watcher means anything that's not stale awaiting-user.
  const isLiveTailable = session.state.kind !== 'awaiting-user' || session.state.freshnessTier !== 'stale';
  useEffect(() => {
    void open(session.id, isLiveTailable);
    return () => { void close(session.id); };
  }, [session.id, isLiveTailable, open, close]);

  const messages = slice?.messages ?? [];
  const rows = useMemo(() => buildRows(messages), [messages]);

  // Compute live stats from the full message list so numbers update as
  // new events arrive and reflect actual token usage / cost. The same loop
  // also captures the *latest* model and permissionMode so model swaps and
  // permission-mode changes mid-session are reflected in the stats strip.
  const liveStats = useMemo(() => {
    let totalTokens = 0, totalCostUsd = 0, messageCount = 0;
    let latestModel: string | null = null;
    let latestPermissionMode: string | null = null;
    for (const m of messages) {
      if (m.kind === 'assistant-usage') totalTokens += m.inputTokens + m.outputTokens;
      if (m.kind === 'session-result') totalCostUsd = m.costUsd;
      if (m.kind === 'user-prompt' || m.kind === 'assistant-text') messageCount++;
      // assistant-text carries model per turn — the last one wins.
      if (m.kind === 'assistant-text' && m.model) latestModel = m.model;
      // user-prompt may carry permissionMode — the last one wins.
      if (m.kind === 'user-prompt' && typeof m.permissionMode === 'string') {
        latestPermissionMode = m.permissionMode;
      }
    }
    return { totalTokens, totalCostUsd, messageCount, latestModel, latestPermissionMode };
  }, [messages]);

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <DetailHeader session={session} onBack={() => setView('sessions')} railOpen={railOpen} onToggleRail={onToggleRail} />
      <StatsStrip session={session} liveStats={liveStats} />
      <Timeline key={session.id} rows={rows} session={session} loading={!!slice?.loading} />
    </div>
  );
}

function DetailHeader({ session, onBack, railOpen, onToggleRail }: {
  session: SessionMeta;
  onBack: () => void;
  railOpen: boolean;
  onToggleRail: () => void;
}) {
  return (
    <div className="sticky top-0 z-10 shrink-0 border-b border-rule bg-bg/95 backdrop-blur px-4 py-3 flex items-start gap-3">
      <button
        onClick={onToggleRail}
        className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-xs border border-rule text-fg-3 hover:text-fg"
        title={railOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {railOpen ? '◂' : '▸'}
      </button>
      <button
        onClick={onBack}
        className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-xs border border-rule text-fg-3 hover:text-fg"
        title="Back to grid (Esc)"
      >
        ←
      </button>
      <AdapterMark adapterId={session.adapter} size={28} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-semibold tracking-head2">{session.projectLabel}</h2>
        <div className="mt-0.5 flex items-center gap-2 font-mono text-2xs text-fg-4">
          {session.gitBranch && <span>⎇ {session.gitBranch}</span>}
          <span className="truncate">{session.cwd}</span>
        </div>
      </div>
      <StatusPill state={session.state} />
      <div className="flex items-center gap-1">
        <IconButton title="Reveal in Finder">⤴</IconButton>
        <IconButton title="Copy session id">⎘</IconButton>
        <IconButton title="Notifications">◔</IconButton>
      </div>
    </div>
  );
}

function IconButton({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <button
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-xs border border-rule text-fg-3 hover:text-fg hover:border-rule-2"
    >
      {children}
    </button>
  );
}

interface LiveStats {
  totalTokens: number;
  totalCostUsd: number;
  messageCount: number;
  latestModel: string | null;
  latestPermissionMode: string | null;
}

function StatsStrip({ session, liveStats }: { session: SessionMeta; liveStats: LiveStats }) {
  const now = useNow(10_000); // refresh duration every 10s
  const startedMs = Date.parse(session.startedAt);
  const lastMs = Date.parse(session.lastActivityAt);
  const duration = Number.isFinite(startedMs) && Number.isFinite(lastMs)
    ? Math.max(0, Math.round((Math.max(lastMs, now) - startedMs) / 1000))
    : 0;

  // Prefer live values from in-memory messages; fall back to the meta
  // captured at session-list time. This is what makes mid-session model
  // swaps and permission-mode changes show up in the strip.
  const displayModel = liveStats.latestModel ?? session.model;
  const displayPermissionMode = liveStats.latestPermissionMode ?? session.permissionMode;
  // Re-classify the latest model for cloud/local visual treatment.
  const displayModelClass = liveStats.latestModel
    ? classifyModel(liveStats.latestModel)
    : { modelClass: session.modelClass, modelProvider: session.modelProvider };

  return (
    <div className="grid shrink-0 grid-cols-7 divide-x divide-rule border-b border-rule bg-bg-2">
      <Stat label="MODEL">
        <ModelBadge
          model={displayModel}
          modelClass={displayModelClass.modelClass}
          provider={displayModelClass.modelProvider}
          compact
        />
      </Stat>
      <Stat label="COST"><span className="tnum">{fmtCost(liveStats.totalCostUsd)}</span></Stat>
      <Stat label="TOKENS"><span className="tnum">{fmtTokens(liveStats.totalTokens)}</span></Stat>
      <Stat label="MESSAGES"><span className="tnum">{liveStats.messageCount}</span></Stat>
      <Stat label="DURATION"><span className="tnum">{fmtDuration(duration)}</span></Stat>
      <Stat label="PERMISSION"><span className="font-mono text-xs">{displayPermissionMode ?? '—'}</span></Stat>
      <Stat label="VERSION"><span className="font-mono text-xs">{session.agentVersion ?? '—'}</span></Stat>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-3 py-2">
      <div className="font-mono text-2xs tracking-caps text-fg-4">{label}</div>
      <div className="text-md font-semibold">{children}</div>
    </div>
  );
}

function Timeline({ rows, session, loading }: { rows: TimelineRow[]; session: SessionMeta; loading: boolean }) {
  // Most-recent-first: reverse so newest events appear at the top.
  const reversed = [...rows].reverse();
  const useVirtual = reversed.length > VIRTUALIZE_THRESHOLD;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  // Only user-prompt rows get a ref — keyed by message uuid.
  const promptEls = useRef(new Map<string, HTMLElement>());
  // The off-screen prompt to show in the context banner. `direction` tells the
  // banner which arrow to render — 'above' means the prompt is scrolled past
  // upward (newer side), 'below' means it's below the viewport (older side).
  const [jumpTarget, setJumpTarget] = useState<{ text: string; uuid: string; direction: 'above' | 'below' } | null>(null);

  // Returns true if any user-prompt element is currently visible in the scroll container.
  function anyPromptVisible(): boolean {
    const container = scrollRef.current;
    if (!container) return false;
    const { top: cTop, bottom: cBottom } = container.getBoundingClientRect();
    for (const [, el] of promptEls.current) {
      const { top, bottom } = el.getBoundingClientRect();
      if (top < cBottom && bottom > cTop) return true;
    }
    return false;
  }

  // Find the closest off-screen prompt — preferring ABOVE the viewport (the
  // one the reader just scrolled past going down through reversed history).
  // Falls back to BELOW the viewport when there's nothing above (e.g. user
  // scrolled up past a prompt and now sits in fresh content with the prompt
  // below the bottom edge).
  function findOffscreenPromptForBanner(): { text: string; uuid: string; direction: 'above' | 'below' } | null {
    const container = scrollRef.current;
    if (!container) return null;
    const { top: cTop, bottom: cBottom } = container.getBoundingClientRect();
    let closestAbove: { text: string; uuid: string; distance: number } | null = null;
    let closestBelow: { text: string; uuid: string; distance: number } | null = null;
    for (const row of reversed) {
      if (row.message.kind !== 'user-prompt') continue;
      const el = promptEls.current.get(row.message.uuid);
      if (!el) continue;
      const { top: elTop, bottom: elBottom } = el.getBoundingClientRect();
      if (elBottom <= cTop) {
        const distance = cTop - elBottom;
        if (!closestAbove || distance < closestAbove.distance) {
          closestAbove = { text: row.message.text, uuid: row.message.uuid, distance };
        }
      } else if (elTop >= cBottom) {
        const distance = elTop - cBottom;
        if (!closestBelow || distance < closestBelow.distance) {
          closestBelow = { text: row.message.text, uuid: row.message.uuid, distance };
        }
      }
    }
    if (closestAbove) return { text: closestAbove.text, uuid: closestAbove.uuid, direction: 'above' };
    if (closestBelow) return { text: closestBelow.text, uuid: closestBelow.uuid, direction: 'below' };
    return null;
  }

  function onScroll() {
    if (anyPromptVisible()) { setJumpTarget(null); return; }
    setJumpTarget(findOffscreenPromptForBanner());
  }

  function jumpToTarget() {
    if (!jumpTarget) return;
    const el = promptEls.current.get(jumpTarget.uuid);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (useVirtual) {
      const idx = reversed.findIndex(r => r.message.kind === 'user-prompt' && r.message.uuid === jumpTarget.uuid);
      if (idx !== -1) virtuosoRef.current?.scrollToIndex({ index: idx, behavior: 'smooth' });
    }
    setJumpTarget(null);
  }

  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-3 text-sm">Loading timeline…</div>
    );
  }

  // Live-tail banner — shown at the top (newest end) when something's in flight.
  const showLiveBanner = session.state.kind === 'working' || session.state.kind === 'blocked';
  const LiveBanner = showLiveBanner ? (
    <div className="grid items-start gap-x-[14px]" style={{ gridTemplateColumns: '56px 1fr' }}>
      <div />
      <div className="relative pt-1 pb-2">
        <div className="absolute top-0 bottom-0 w-px bg-rule" style={{ left: 8 }} />
        <div
          className="absolute top-1.5 rounded-full bg-live helm-pulse"
          style={{ left: 4, width: 9, height: 9 }}
        />
        <div className="pl-7 font-mono text-2xs tracking-caps text-live">tailing live · waiting for next event</div>
      </div>
    </div>
  ) : null;

  // Session-opened marker — shown at the bottom (oldest end).
  const OpenedMarker = (
    <div className="grid items-start gap-x-[14px]" style={{ gridTemplateColumns: '56px 1fr' }}>
      <div className="text-right font-mono text-2xs text-fg-4 tnum pt-1">—</div>
      <div className="relative pb-3">
        <div className="absolute top-0 bottom-0 w-px bg-rule" style={{ left: 8 }} />
        <div className="absolute top-1.5 rounded-full bg-accent border border-bg" style={{ left: 4, width: 9, height: 9 }} />
        <div className="pl-7 font-mono text-2xs tracking-caps text-fg-3">SESSION OPENED</div>
      </div>
    </div>
  );

  const jumpBanner = jumpTarget ? (
    <button
      onClick={jumpToTarget}
      className={clsx(
        'absolute bottom-0 inset-x-0 z-20',
        'flex items-center gap-3 px-4 py-2.5',
        'border-t border-rule bg-bg-2/95 backdrop-blur',
        'text-left transition-opacity hover:bg-bg-3',
      )}
    >
      <span className="shrink-0 font-mono text-2xs tracking-caps text-accent">
        {jumpTarget.direction === 'above' ? '↑ IN REPLY TO' : '↓ SCROLL TO'}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-fg-2">{jumpTarget.text}</span>
    </button>
  ) : null;

  if (useVirtual) {
    return (
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <Virtuoso
          ref={virtuosoRef}
          data={reversed}
          rangeChanged={({ startIndex, endIndex }) => {
            // If any user-prompt is in the visible range, suppress the banner.
            const visibleHasPrompt = reversed
              .slice(startIndex, endIndex + 1)
              .some(r => r.message.kind === 'user-prompt');
            if (visibleHasPrompt) { setJumpTarget(null); return; }

            // Prefer the prompt ABOVE the visible range (the one the reader
            // just scrolled past going down through reversed history).
            // Walk indices [startIndex - 1 .. 0] to find the closest above.
            let above: { text: string; uuid: string } | null = null;
            for (let i = startIndex - 1; i >= 0; i--) {
              const r = reversed[i];
              if (r && r.message.kind === 'user-prompt') {
                above = { text: r.message.text, uuid: r.message.uuid };
                break;
              }
            }
            if (above) {
              setJumpTarget({ ...above, direction: 'above' });
              return;
            }
            // Fallback: find a prompt BELOW the visible range (user scrolled
            // up past it and now there's no prompt above).
            const below = reversed.slice(endIndex + 1)
              .find(r => r.message.kind === 'user-prompt');
            setJumpTarget(
              below?.message.kind === 'user-prompt'
                ? { text: below.message.text, uuid: below.message.uuid, direction: 'below' }
                : null,
            );
          }}
          components={{
            Header: () => <div className="mx-auto max-w-[880px] px-4 pt-4">{LiveBanner}</div>,
            Footer: () => <div className="mx-auto max-w-[880px] px-4 pb-6">{OpenedMarker}</div>,
          }}
          itemContent={(i, row) => (
            <div className="mx-auto max-w-[880px] px-4">
              <TimelineEvent row={row} isLast={i === reversed.length - 1} />
            </div>
          )}
        />
        {jumpBanner}
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[880px] px-4 py-4">
          {LiveBanner}
          {reversed.map((row, i) => (
            <div
              key={`${row.message.kind}-${row.message.uuid}`}
              ref={row.message.kind === 'user-prompt' ? el => {
                if (el) promptEls.current.set(row.message.uuid, el);
                else promptEls.current.delete(row.message.uuid);
              } : undefined}
            >
              <TimelineEvent row={row} isLast={i === reversed.length - 1} />
            </div>
          ))}
          {OpenedMarker}
        </div>
      </div>
      {jumpBanner}
    </div>
  );
}

/**
 * Pair tool-result events with their tool-call by toolUseId. Orphan
 * results are dropped (logged once) so they don't render twice.
 *
 * For each user-prompt, find the next assistant-text with a model and
 * tag the row with `respondedBy` so the UI can label which model answered
 * (especially useful when the user swaps models mid-session).
 */
function buildRows(messages: Message[]): TimelineRow[] {
  const resultsByToolUseId = new Map<string, Extract<Message, { kind: 'tool-result' }>>();
  for (const m of messages) {
    if (m.kind === 'tool-result') resultsByToolUseId.set(m.toolUseId, m);
  }

  // Walk forward once and build a uuid → respondedBy lookup. The "next
  // assistant-text with a model" search runs lazily — we keep the most
  // recent unanswered user-prompt and assign it as soon as the next
  // assistant-text arrives. A subsequent user-prompt before any model-
  // bearing assistant-text means the previous prompt got no real reply
  // (rare, but possible during an in-flight session) — leave its
  // respondedBy unset.
  const respondedBy = new Map<string, string>();
  let pendingPromptUuid: string | null = null;
  for (const m of messages) {
    if (m.kind === 'user-prompt') {
      pendingPromptUuid = m.uuid;
    } else if (m.kind === 'assistant-text' && m.model && pendingPromptUuid !== null) {
      respondedBy.set(pendingPromptUuid, m.model);
      pendingPromptUuid = null;
    }
  }

  const seenCallIds = new Set<string>();
  const rows: TimelineRow[] = [];
  for (const m of messages) {
    if (m.kind === 'tool-result') {
      // Skip; pair below.
      continue;
    }
    if (m.kind === 'tool-call') {
      seenCallIds.add(m.toolUseId);
      const paired = resultsByToolUseId.get(m.toolUseId);
      rows.push(paired ? { message: m, pairedResult: paired } : { message: m });
      continue;
    }
    if (m.kind === 'user-prompt') {
      const model = respondedBy.get(m.uuid);
      rows.push(model ? { message: m, respondedBy: model } : { message: m });
      continue;
    }
    rows.push({ message: m });
  }
  // Orphan-result diagnostic.
  for (const [id, r] of resultsByToolUseId) {
    if (!seenCallIds.has(id)) console.warn('[timeline] orphan tool-result', id, r);
  }
  return rows;
}

const _silenceUnused = clsx;
void _silenceUnused;
