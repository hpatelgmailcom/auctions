import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { RecommendationBadge, CrimeGradeBadge, AuctionCountdown, Spinner } from '../components/index.js';

const fmt$ = v => v != null ? `$${Number(v).toLocaleString()}` : '—';

const STAGE_COLORS = {
  'Scouted':      'border-t-slate-500',
  'Enriching':    'border-t-sky-500',
  'Enriched':     'border-t-blue-500',
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
  const live = isLiveNow(listing.bidding_starts, listing.bidding_ends);
  return (
    <div onClick={onClick}
      className="bg-surface-card border border-surface-border rounded-xl p-3.5 cursor-pointer hover:border-brand/40 hover:bg-surface-hover transition-all space-y-2">
      <div>
        <p className="text-xs font-medium text-ink leading-tight truncate">{listing.address}</p>
        <p className="text-[10px] text-ink-subtle">{listing.city}, {listing.state}</p>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold font-mono text-ink">{fmt$(listing.starting_bid_usd)}</span>
        <RecommendationBadge value={listing.recommendation} />
      </div>
      <div className="flex items-center justify-between">
        <CrimeGradeBadge grade={listing.crime_grade} />
        <AuctionCountdown date={listing.bidding_starts} endDate={listing.bidding_ends} compact />
      </div>
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

export default function PipelinePage() {
  const navigate = useNavigate();
  const { data, loading } = useFetch(() => api.pipeline.board());

  if (loading) return <Spinner />;
  const { stages = [], groups = {} } = data || {};

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink">Pipeline</h1>
        <p className="text-sm text-ink-subtle mt-0.5">Drag listings between stages to track progress</p>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 140px)' }}>
        {stages.map(stage => {
          const cards = groups[stage] || [];
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
