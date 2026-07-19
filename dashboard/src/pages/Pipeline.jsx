import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { useFetch } from '../hooks/useFetch.js';
import { useStickyState } from '../hooks/useStickyState.js';
import { api } from '../api/client.js';
import { RecommendationBadge, CrimeGradeBadge, AuctionCountdown, Spinner, SourceBadge, AssetClassTabs, SOURCE_NAMES } from '../components/index.js';

const fmt$ = v => v != null ? `$${Number(v).toLocaleString()}` : '—';

const STAGE_COLORS = {
  'Scouted':      'border-t-slate-500',
  'Enriching':    'border-t-sky-500',
  'Enriched':     'border-t-blue-500',
  'Due Diligence': 'border-t-indigo-500',
  'Under Review': 'border-t-amber-500',
  'BID':          'border-t-emerald-500',
  'NO BID':       'border-t-red-500',
  'CONDITIONAL':  'border-t-yellow-500',
  'Auction Day':  'border-t-purple-500',
  'Closed':       'border-t-slate-400',
};

function fmtDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

function isLiveNow(starts, ends) {
  if (!starts) return false;
  const now = Date.now();
  return now >= new Date(starts).getTime() && (!ends || now <= new Date(ends).getTime());
}

function ListingCard({ listing, onClick }) {
  const live   = isLiveNow(listing.bidding_starts, listing.bidding_ends);
  const isSale = listing.listing_type === 'sale';
  return (
    <div onClick={onClick}
      className="bg-surface-card border border-surface-border rounded-xl p-3.5 cursor-pointer hover:border-brand/40 hover:bg-surface-hover transition-all space-y-2">
      <div>
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium text-ink leading-tight truncate flex-1">{listing.address}</p>
          <SourceBadge source={listing.source} />
        </div>
        <p className="text-[10px] text-ink-subtle">
          {listing.city}, {listing.state}
          {listing.asset_class === 'residential' && (listing.beds != null || listing.baths != null) && (
            <span className="ml-1">· {[listing.beds != null ? `${listing.beds}bd` : null, listing.baths != null ? `${listing.baths}ba` : null].filter(Boolean).join(' ')}</span>
          )}
        </p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold font-mono text-ink">
          {fmt$(isSale ? listing.asking_price_usd : listing.starting_bid_usd)}
          {isSale ? <span className="ml-1 text-[10px] font-sans font-normal text-ink-subtle">asking</span> : null}
        </span>
        <RecommendationBadge value={listing.recommendation} />
      </div>
      <div className="flex items-center justify-between">
        <CrimeGradeBadge grade={listing.crime_grade} />
        {isSale ? (
          listing.cap_rate_pct != null
            ? <span className="text-[10px] text-ink-subtle font-mono">{listing.cap_rate_pct}% cap</span>
            : null
        ) : (
          <AuctionCountdown date={listing.bidding_starts} endDate={listing.bidding_ends} compact />
        )}
      </div>
      {isSale ? null : (
        <div className="text-[10px] text-ink-subtle space-y-0.5 border-t border-surface-border pt-1.5">
          {listing.bidding_starts && (
            <div className="flex justify-between">
              <span className="text-ink-subtle">Start</span>
              <span className="font-mono">{fmtDate(listing.bidding_starts)}</span>
            </div>
          )}
          {listing.bidding_ends && (
            <div className="flex justify-between">
              <span className={live ? 'text-emerald-400' : 'text-ink-subtle'}>End</span>
              <span className={`font-mono ${live ? 'text-emerald-400 font-semibold' : ''}`}>{fmtDate(listing.bidding_ends)}</span>
            </div>
          )}
        </div>
      )}
      {listing.disposition_score != null && (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 bg-surface rounded-full h-1">
            <div className="h-1 rounded-full bg-brand" style={{ width: `${listing.disposition_score * 10}%` }} />
          </div>
          <span className="text-[10px] text-ink-subtle font-mono">{listing.disposition_score.toFixed(1)}</span>
        </div>
      )}
    </div>
  );
}

// Shared with Screening — one filter set carried across pages.
const SHARED_DEFAULTS = { asset_class: '', source: '', listing_type: '' };

export default function PipelinePage() {
  const navigate = useNavigate();
  // Sticky + shared — selections survive navigation/reloads and carry to Screening
  const [filters, setFilters] = useStickyState('shared-filters', SHARED_DEFAULTS);
  const { asset_class: assetClass, source, listing_type: listingType } = filters;
  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));
  const activeCount = Object.values(filters).filter(Boolean).length;
  const { data, loading } = useFetch(() => api.pipeline.board());

  if (loading) return <Spinner />;
  const { stages = [], groups = {} } = data || {};

  const all = Object.values(groups).flat();
  // Options come from the data, so new providers appear without a code change.
  const sourceOptions = [...new Set(all.map(c => c.source).filter(Boolean))].sort();

  const matches = c =>
    (!assetClass  || (c.asset_class ?? 'commercial') === assetClass) &&
    (!source      || c.source === source) &&
    (!listingType || (c.listing_type ?? 'auction') === listingType);
  const counts = all.reduce((acc, c) => {
    const k = c.asset_class ?? 'commercial';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-6 pt-0">
      {/* Pinned while the board scrolls; filter state itself is sticky via localStorage */}
      <div className="sticky top-0 z-20 -mx-6 px-6 pt-6 pb-4 mb-4 bg-surface/95 backdrop-blur border-b border-surface-border flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
          <p className="text-sm text-ink-subtle mt-0.5">Drag listings between stages to track progress</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input text-xs py-1.5" value={source} onChange={e => setFilter('source', e.target.value)} aria-label="Provider">
            <option value="">All Providers</option>
            {sourceOptions.map(s => <option key={s} value={s}>{SOURCE_NAMES[s] || s}</option>)}
          </select>
          <select className="input text-xs py-1.5" value={listingType} onChange={e => setFilter('listing_type', e.target.value)} aria-label="Listing type">
            <option value="">Auctions + Sales</option>
            <option value="auction">Auctions</option>
            <option value="sale">For Sale (email)</option>
          </select>
          <AssetClassTabs value={assetClass} onChange={v => setFilter('asset_class', v)} counts={counts} />
          {activeCount > 0 && (
            <button onClick={() => setFilters(SHARED_DEFAULTS)}
              className="btn-ghost flex items-center gap-1 text-xs text-ink-muted"
              title="Clear all filters">
              <X size={12} /> Reset
            </button>
          )}
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 140px)' }}>
        {stages.map(stage => {
          const cards = (groups[stage] || []).filter(matches);
          return (
            <div key={stage} className="shrink-0 w-64 flex flex-col gap-2">
              {/* Column header */}
              <div className={clsx(
                'bg-surface-card border border-surface-border rounded-xl px-3 py-2.5 border-t-2',
                STAGE_COLORS[stage] || 'border-t-slate-500'
              )}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-ink">{stage}</span>
                  <span className="text-[10px] text-ink-subtle bg-surface rounded-full px-2 py-0.5 font-mono">
                    {cards.length}
                  </span>
                </div>
              </div>
              {/* Cards */}
              <div className="flex flex-col gap-2 flex-1">
                {cards.map(l => (
                  <ListingCard key={l.id} listing={l} onClick={() => navigate(`/listing/${l.id}`)} />
                ))}
                {cards.length === 0 && (
                  <div className="border-2 border-dashed border-surface-border rounded-xl p-4 text-center">
                    <p className="text-xs text-ink-subtle">Empty</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
