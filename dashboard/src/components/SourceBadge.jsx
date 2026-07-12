import clsx from 'clsx';

const SOURCES = {
  crexi:       { label: 'Crexi',       cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  auction_com: { label: 'Auction.com', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
};

/** Small pill showing which provider a listing came from. */
export default function SourceBadge({ source, className }) {
  if (!source) return null;
  const s = SOURCES[source] || { label: source, cls: 'bg-surface text-ink-muted border-surface-border' };
  return (
    <span className={clsx(
      'inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
      s.cls, className,
    )}>
      {s.label}
    </span>
  );
}
