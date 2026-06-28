import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import clsx from 'clsx';
import { Bell, BellOff, AlertTriangle, Clock, Info, CheckCheck } from 'lucide-react';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { AuctionCountdown, Spinner, EmptyState } from '../components/index.js';

const SEVERITY_ICON = {
  critical: <AlertTriangle size={14} className="text-nobid shrink-0" />,
  warning:  <Clock size={14} className="text-conditional shrink-0" />,
  info:     <Info size={14} className="text-brand shrink-0" />,
};

const TYPE_LABEL = {
  deadline:        'Auction Deadline',
  pending_review:  'Pending Review',
  new_listing:     'New Listing',
};

export default function AlertsPage({ onSeenChange }) {
  const navigate    = useNavigate();
  const [filter, setFilter] = useState('unseen');
  const { data: alerts = [], loading, reload } = useFetch(
    () => api.alerts.list(filter === 'unseen'),
    [filter]
  );

  async function markSeen(id, e) {
    e.stopPropagation();
    await api.alerts.seen(id);
    reload();
    api.alerts.count().then(d => onSeenChange?.(d.unseen)).catch(() => {});
  }

  async function markAllSeen() {
    await api.alerts.seenAll();
    reload();
    onSeenChange?.(0);
  }

  const unseen = alerts.filter(a => !a.seen).length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink">Alerts</h1>
          <p className="text-sm text-ink-subtle mt-0.5">{unseen} unseen</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-surface-border overflow-hidden text-sm">
            {['unseen','all'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={clsx('px-3 py-1.5 capitalize transition-colors',
                  filter === f ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-hover')}>
                {f}
              </button>
            ))}
          </div>
          {unseen > 0 && (
            <button onClick={markAllSeen} className="btn-ghost flex items-center gap-1.5 text-xs">
              <CheckCheck size={12} /> Mark all seen
            </button>
          )}
        </div>
      </div>

      {loading ? <Spinner /> : alerts.length === 0 ? (
        <EmptyState message={filter === 'unseen' ? 'No unseen alerts' : 'No alerts'} />
      ) : (
        <div className="space-y-2">
          {alerts.map(alert => (
            <div key={alert.id}
              onClick={() => alert.listing_id && navigate(`/listing/${alert.listing_id}`)}
              className={clsx(
                'card p-4 flex items-start gap-3 transition-all',
                alert.listing_id && 'cursor-pointer hover:border-brand/30',
                !alert.seen && 'border-l-2',
                alert.severity === 'critical' && !alert.seen && 'border-l-nobid',
                alert.severity === 'warning'  && !alert.seen && 'border-l-conditional',
                alert.severity === 'info'     && !alert.seen && 'border-l-brand',
              )}>
              <div className="mt-0.5">{SEVERITY_ICON[alert.severity] || SEVERITY_ICON.info}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-semibold text-ink-subtle uppercase tracking-wider">
                      {TYPE_LABEL[alert.type] || alert.type}
                    </span>
                    <p className="text-sm text-ink mt-0.5">{alert.message}</p>
                    {alert.address && (
                      <p className="text-xs text-ink-subtle mt-0.5 truncate">{alert.address}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {alert.bidding_starts && (
                      <AuctionCountdown date={alert.bidding_starts} compact />
                    )}
                    {!alert.seen && (
                      <button onClick={(e) => markSeen(alert.id, e)}
                        className="p-1 rounded hover:bg-surface text-ink-subtle hover:text-ink transition-colors"
                        title="Mark seen">
                        <BellOff size={12} />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-ink-subtle mt-1.5">
                  {alert.created_at ? format(new Date(alert.created_at), 'MMM d, h:mm a') : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
