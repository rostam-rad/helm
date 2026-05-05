import { useMemo } from 'react';
import type { SessionMeta } from '@shared/types';
import { computeCostRollup, type Bucket } from '../lib/cost-rollup';
import { fmtCost } from '../lib/format';
import { useNow } from '../lib/useNow';

interface Props {
  sessions: SessionMeta[];
}

/**
 * Cost rollup strip — three buckets (today / week / month) across all
 * sessions. Cloud cost only ($0 for local, by definition); session
 * counts include both classes broken down underneath.
 *
 * Lives above the existing summary strip in SessionsView. Pure
 * presentational; the rollup is memoized on `sessions` and recomputed
 * once a minute via useNow so the day boundary advances without a
 * manual refresh.
 */
export function CostRollup({ sessions }: Props) {
  const now = useNow(60_000); // refresh once a minute — bucket boundaries are coarse
  const rollup = useMemo(() => computeCostRollup(sessions, new Date(now)), [sessions, now]);

  return (
    <div
      className="grid shrink-0 divide-x divide-rule border-b border-rule bg-bg-2"
      style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}
    >
      <BucketCell label="today" bucket={rollup.today} />
      <BucketCell label="this week" bucket={rollup.week} />
      <BucketCell label="this month" bucket={rollup.month} />
    </div>
  );
}

function BucketCell({ label, bucket }: { label: string; bucket: Bucket }) {
  const sessionsLabel = bucket.sessionCount === 1 ? 'session' : 'sessions';
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xs tracking-caps text-fg-4">{label.toUpperCase()}</span>
        <span className="text-xl font-semibold tracking-head2 tnum">{fmtCost(bucket.totalCostUsd)}</span>
      </div>
      <div className="flex items-baseline gap-2 font-mono text-2xs tracking-caps text-fg-3 tnum">
        <span>{bucket.sessionCount} {sessionsLabel}</span>
        <span className="text-fg-4/60">·</span>
        <span>{bucket.cloudCount} cloud</span>
        <span className="text-fg-4/60">·</span>
        <span>{bucket.localCount} local</span>
      </div>
    </div>
  );
}
