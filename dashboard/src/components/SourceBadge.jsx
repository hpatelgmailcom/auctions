import clsx from 'clsx';

export const SOURCES = {
  crexi:                   { label: 'Crexi',       cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  auction_com:             { label: 'Auction.com', cls: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  cushman_wakefield:       { label: 'C&W',         cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  marcus_millichap:        { label: 'M&M',         cls: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  boulder_group:           { label: 'Boulder',     cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  colliers_central_valley: { label: 'Colliers',    cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  elevate_net_lease:       { label: 'Elevate',     cls: 'bg-lime-500/15 text-lime-400 border-lime-500/30' },
  kiser_group:             { label: 'Kiser',       cls: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  wallet_wise:             { label: 'Walletwise',  cls: 'bg-rose-500/15 text-rose-400 border-rose-500/30' },
  cbre_rcm:                { label: 'CBRE',        cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
  visintainer_group:       { label: 'Visintainer', cls: 'bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30' },
};

/** Full display name for filter dropdowns (badge labels stay short). */
export const SOURCE_NAMES = {
  crexi:                   'Crexi',
  auction_com:             'Auction.com',
  cushman_wakefield:       'Cushman & Wakefield',
  marcus_millichap:        'Marcus & Millichap',
  boulder_group:           'The Boulder Group',
  colliers_central_valley: 'Colliers Central Valley',
  elevate_net_lease:       'Elevate Net Lease',
  kiser_group:             'Kiser Group',
  wallet_wise:             'The Walletwise',
  cbre_rcm:                'CBRE',
  visintainer_group:       'Visintainer Group',
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
