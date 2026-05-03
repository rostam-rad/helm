import clsx from 'clsx';
import type { SessionState } from '@shared/types';

interface Props {
  state: SessionState;
  className?: string;
}

interface Spec {
  label: string;
  dot: string;
  text: string;
  bg: string;
  pulse: boolean;
}

function specFor(state: SessionState): Spec {
  if (state.kind === 'working') {
    return { label: 'WORKING', dot: 'bg-live', text: 'text-live', bg: 'bg-live-soft', pulse: true };
  }
  if (state.kind === 'blocked') {
    const labelByReason: Record<string, string> = {
      permission: 'PERMISSION',
      question: 'NEEDS YOU',
      'plan-review': 'PLAN REVIEW',
    };
    return {
      label: labelByReason[state.reason.type] ?? 'BLOCKED',
      dot: 'bg-error',
      text: 'text-error',
      bg: 'bg-error-soft',
      pulse: true,
    };
  }
  // awaiting-user — visual treatment varies by freshness
  if (state.freshnessTier === 'fresh') {
    return { label: 'AWAITING', dot: 'bg-warn', text: 'text-warn', bg: 'bg-warn-soft', pulse: false };
  }
  if (state.freshnessTier === 'recent') {
    return { label: 'AWAITING', dot: 'bg-warn', text: 'text-fg-3', bg: 'bg-bg-3', pulse: false };
  }
  // stale — visually quiet, formerly the "idle" treatment
  return { label: 'IDLE', dot: 'bg-fg-4', text: 'text-fg-3', bg: 'bg-bg-3', pulse: false };
}

export function StatusPill({ state, className }: Props) {
  const s = specFor(state);
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-2xs font-semibold tracking-caps',
        s.bg,
        s.text,
        className,
      )}
    >
      <span
        className={clsx('rounded-full', s.dot, s.pulse && 'helm-pulse')}
        style={{ width: 6, height: 6 }}
      />
      {s.label}
    </span>
  );
}
