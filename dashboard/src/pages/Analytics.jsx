import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { StatCard, Spinner } from '../components/index.js';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  FunnelChart, Funnel, LabelList, Cell,
} from 'recharts';
import { TrendingUp, Building2, DollarSign, Shield } from 'lucide-react';

const fmt$ = v => v != null ? `$${Number(v).toLocaleString(0)}` : '—';

const FUNNEL_COLORS = [
  '#475569','#3b82f6','#6366f1','#f59e0b','#10b981','#ef4444','#f59e0b','#a855f7','#64748b'
];

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-card border border-surface-border rounded-lg px-3 py-2 text-xs shadow-lg">
      <p className="text-ink font-medium">{payload[0].payload.state}</p>
      <p className="text-ink-muted">Listings: <span className="text-ink">{payload[0].payload.count}</span></p>
      <p className="text-ink-muted">Avg Bid: <span className="text-ink">{fmt$(payload[0].payload.avg_bid)}</span></p>
    </div>
  );
};

export default function AnalyticsPage() {
  const { data: funnel,  loading: fl } = useFetch(() => api.analytics.funnel());
  const { data: snap,    loading: sl } = useFetch(() => api.analytics.snapshot());

  const loading = fl || sl;
  if (loading) return <Spinner />;

  const t = snap?.totals || {};

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Analytics</h1>
        <p className="text-sm text-ink-subtle mt-0.5">Aggregate view across all scouted opportunities</p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Listings"     value={t.total}                           icon={Building2} />
        <StatCard label="Enriched"           value={t.enriched}                        icon={TrendingUp} />
        <StatCard label="BID Recommendations" value={t.bids}  accent="text-bid"        icon={TrendingUp} />
        <StatCard label="Avg Starting Bid"   value={fmt$(t.avg_bid)}                   icon={DollarSign} />
        <StatCard label="Avg Retail $/SF"    value={t.avg_retail_rent != null ? `$${Number(t.avg_retail_rent).toFixed(2)}` : '—'} icon={DollarSign} />
        <StatCard label="Avg Disposition"    value={t.avg_disposition != null ? `${Number(t.avg_disposition).toFixed(1)}/10` : '—'} icon={Shield} />
        <StatCard label="Min Bid"            value={fmt$(t.min_bid)}  accent="text-bid" />
        <StatCard label="Max Bid"            value={fmt$(t.max_bid)}  accent="text-nobid" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Pipeline funnel */}
        <div className="card p-5">
          <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-5">Pipeline Funnel</h3>
          {funnel && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="stage" width={90} tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" radius={[0,4,4,0]}>
                  {funnel.map((entry, i) => <Cell key={i} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* By State */}
        <div className="card p-5">
          <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-5">Listings by State</h3>
          {snap?.byState?.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={snap.byState} margin={{ left: -10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="state" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <p className="text-sm text-ink-subtle text-center py-16">Not enough data</p>}
        </div>

        {/* Crime distribution */}
        <div className="card p-5">
          <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-4">Crime Grade Distribution</h3>
          {snap?.crimeDistribution?.length > 0 ? (
            <div className="space-y-2">
              {snap.crimeDistribution.map(({ crime_grade, count }) => {
                const pct = Math.round((count / t.total) * 100);
                const color = crime_grade?.[0] === 'A' ? 'bg-bid' : crime_grade?.[0] === 'B' ? 'bg-sky-500' :
                              crime_grade?.[0] === 'C' ? 'bg-yellow-500' : crime_grade?.[0] === 'D' ? 'bg-orange-500' : 'bg-red-500';
                return (
                  <div key={crime_grade} className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold text-ink w-8 text-right">{crime_grade || '—'}</span>
                    <div className="flex-1 bg-surface rounded-full h-2">
                      <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-ink-subtle w-12 text-right">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-ink-subtle text-center py-8">No crime data enriched yet</p>}
        </div>

        {/* By property type */}
        <div className="card p-5">
          <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-4">Property Types</h3>
          {snap?.byType?.length > 0 ? (
            <div className="space-y-2">
              {snap.byType.map(({ type, count }) => {
                const parsed = (() => { try { return JSON.parse(type)?.join(', '); } catch { return type; } })();
                const pct = Math.round((count / t.total) * 100);
                return (
                  <div key={type} className="flex items-center gap-3">
                    <span className="text-xs text-ink-muted truncate w-32">{parsed || '—'}</span>
                    <div className="flex-1 bg-surface rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-brand/70" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-ink-subtle w-16 text-right">{count} ({pct}%)</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="text-sm text-ink-subtle text-center py-8">No data</p>}
        </div>
      </div>
    </div>
  );
}
