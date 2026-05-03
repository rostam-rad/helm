import clsx from 'clsx';
import type { AdapterId } from '@shared/types';

interface Props {
  adapterId: AdapterId;
  size?: number;
  className?: string;
}

interface Spec {
  letters: string;
  // Border + tinted-bg color, expressed inline so each adapter can use a
  // hand-picked hue without a new Tailwind palette entry.
  color: string;
}

const SPECS: Record<AdapterId, Spec> = {
  'claude-code': { letters: 'CC', color: 'oklch(0.65 0.15 50)' },   // warm orange
  codex:         { letters: 'CX', color: 'oklch(0.55 0.04 245)' },  // slate
  aider:         { letters: 'AI', color: 'oklch(0.55 0.10 140)' },  // moss
  cline:         { letters: 'CL', color: 'oklch(0.62 0.10 300)' },  // lilac
};

export function AdapterMark({ adapterId, size = 22, className }: Props) {
  const spec = SPECS[adapterId];
  const px = `${size}px`;
  const fontSize = `${Math.max(9, Math.round(size * 0.45))}px`;

  return (
    <span
      role="img"
      aria-label={adapterId}
      className={clsx(
        'inline-flex items-center justify-center rounded-xs font-mono font-semibold tracking-caps',
        'shrink-0 select-none',
        className,
      )}
      style={{
        width: px,
        height: px,
        fontSize,
        color: spec.color,
        backgroundColor: `color-mix(in oklch, ${spec.color} 8%, transparent)`,
        border: `1px solid color-mix(in oklch, ${spec.color} 35%, transparent)`,
      }}
    >
      {spec.letters}
    </span>
  );
}
