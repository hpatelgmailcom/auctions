import clsx from 'clsx';

export const SOURCES = {
  crexi:             { label: 'Crexi',               cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  auction_com:       { label: 'Auction.com',         cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  cushman_wakefield: { label: 'C&W',                 cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
};

/** Full display name for filter dropdowns (badge labels stay short). */
export const SOURCE_NAMES = {
  crexi:             'Crexi',
  auction_com:       'Auction.com',
  cushman_wakefield: 'Cushman & Wakefield',
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
