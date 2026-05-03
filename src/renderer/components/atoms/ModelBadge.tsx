import clsx from 'clsx';
import type { ModelClass } from '@shared/types';

interface Props {
  model: string | null;
  modelClass: ModelClass;
  provider?: string | null;
  compact?: boolean;
  className?: string;
}

export function ModelBadge({ model, modelClass, provider, compact, className }: Props) {
  if (!model) return null;
  const isLocal = modelClass === 'local';
  const isUnknown = modelClass === 'unknown';
  const family =
    isLocal ? { dotBg: 'bg-local', text: 'text-local', soft: 'bg-local-soft', label: 'LOCAL' } :
    isUnknown ? { dotBg: 'bg-fg-4', text: 'text-fg-3', soft: 'bg-bg-3', label: 'MODEL' } :
                { dotBg: 'bg-cloud', text: 'text-cloud', soft: 'bg-cloud-soft', label: 'CLOUD' };

  return (
    <span
      title={provider ? `${provider} · ${model}` : model}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-full font-mono',
        compact ? 'px-1.5 py-0.5 text-2xs' : 'px-2 py-0.5 text-xs',
        family.soft,
        family.text,
        className,
      )}
    >
      <span className={clsx('rounded-full', family.dotBg)} style={{ width: 5, height: 5 }} />
      <span className="font-semibold tracking-caps">{family.label}</span>
      <span className="font-medium opacity-90">{model}</span>
    </span>
  );
}
