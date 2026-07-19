import { useNavigate } from 'react-router-dom';
import { ArchiveRestore, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { Spinner, EmptyState, SourceBadge, RecommendationBadge } from '../components/index.js';

const fmt$ = v => v != null ? `$${Number(v).toLocaleString()}` : '—';

export default function ArchivedPage() {
  const navigate = useNavigate();
  const { data, loading, reload } = useFetch(() => api.listings.archived({ limit: 500 }), []);

  async function handleUnarchive(e, id) {
    e.stopPropagation();
    await api.listings.unarchive(id);
    reload();
  }

  if (loading) return <Spinner />;
  const rows = data?.data ?? [];

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-ink">Archived Properties</h1>
        <p className="text-xs text-ink-subtle">
          {rows.length} archived — hidden from the pipeline and screening views. Restore any time.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState message="No archived properties." />
      ) : (
        <div className="space-y-2">
          {rows.map(l => (
            <div
              key={l.id}
              onClick={() => navigate(`/listing/${l.id}`)}
              className="card p-4 flex items-center gap-4 cursor-pointer hover:bg-surface-hover transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink truncate">{l.title || l.address}</p>
                  <SourceBadge source={l.source} />
                  <RecommendationBadge value={l.recommendation} />
                </div>
                <div className="flex items-center gap-1.5 text-xs text-ink-subtle mt-0.5">
                  <MapPin size={10} className="shrink-0" />
                  <span className="truncate">{l.address}</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-mono text-ink">
                  {l.listing_type === 'sale' ? fmt$(l.asking_price_usd) : fmt$(l.starting_bid_usd)}
                </p>
                <p className="text-[10px] text-ink-subtle">
                  archived {l.archived_at ? format(new Date(l.archived_at.replace(' ', 'T') + 'Z'), 'MMM d, yyyy') : ''}
                </p>
              </div>
              <button
                onClick={e => handleUnarchive(e, l.id)}
                className="btn-ghost flex items-center gap-1.5 text-xs shrink-0"
                title="Restore to pipeline"
              >
                <ArchiveRestore size={13} /> Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
