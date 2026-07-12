import clsx from 'clsx';

const MAP = {
  'BID':         { cls: 'bg-bid-bg text-bid border border-bid/30',             label: 'BID' },
  'NO BID':      { cls: 'bg-nobid-bg text-nobid border border-nobid/30',       label: 'NO BID' },
  'CONDITIONAL': { cls: 'bg-conditional-bg text-conditional border border-conditional/30', label: 'CONDITIONAL' },
  'CONDITIONAL BID': { cls: 'bg-conditional-bg text-conditional border border-conditional/30', label: 'CONDITIONAL' },
};

export default function RecommendationBadge({ value, size = 'sm' }) {
  const cfg = MAP[value] || { cls: 'bg-surface-hover text-ink-muted border border-surface-border', label: value || '—' };
  return (
    <span className={clsx('badge font-semibold tracking-wide', cfg.cls, size === 'lg' && 'text-sm px-3 py-1')}>
      {cfg.label}
    </span>
  );
}
