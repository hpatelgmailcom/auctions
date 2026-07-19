import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, flexRender,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ExternalLink, Filter, X } from 'lucide-react';
import clsx from 'clsx';
import { useFetch } from '../hooks/useFetch.js';
import { useStickyState } from '../hooks/useStickyState.js';
import { api } from '../api/client.js';
import { RecommendationBadge, CrimeGradeBadge, AuctionCountdown, Spinner, EmptyState, MapLinks, SourceBadge, AssetClassTabs, SOURCE_NAMES } from '../components/index.js';

const fmt$ = v => v != null ? `$${Number(v).toLocaleString()}` : '—';
const fmtSF = v => v != null ? `${Number(v).toLocaleString()} SF` : '—';
const fmtDate = iso => {
  if (!iso) return null;
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
};

// Custom sort orders — lower number = better rank
const GRADE_RANK = { 'A+':1,'A':2,'A-':3,'B+':4,'B':5,'B-':6,'C+':7,'C':8,'C-':9,'D+':10,'D':11,'D-':12,'F':13 };
const REC_RANK   = { 'BID':1,'CONDITIONAL':2,'NO BID':3 };
const nullLast   = (a, b, asc) => {
  if (a == null && b == null) return 0;
  if (a == null) return asc ? 1 : -1;
  if (b == null) return asc ? -1 : 1;
  return 0;
};

const gradeSortFn = (rowA, rowB, colId) => {
  const a = rowA.getValue(colId), b = rowB.getValue(colId);
  const nl = nullLast(a, b, true);
  if (nl !== 0) return nl;
  return (GRADE_RANK[a] ?? 99) - (GRADE_RANK[b] ?? 99);
};

const recSortFn = (rowA, rowB, colId) => {
  const a = rowA.getValue(colId), b = rowB.getValue(colId);
  const nl = nullLast(a, b, true);
  if (nl !== 0) return nl;
  return (REC_RANK[a] ?? 99) - (REC_RANK[b] ?? 99);
};

const numSortFn = (rowA, rowB, colId) => {
  const a = rowA.getValue(colId), b = rowB.getValue(colId);
  const nl = nullLast(a, b, true);
  if (nl !== 0) return nl;
  return Number(a) - Number(b);
};

const PROPERTY_TYPES = ['Retail','Office','Industrial','Multifamily','Land','Mixed Use','Hospitality','Healthcare','Flex','Special Purpose'];

function FilterBar({ filters, onChange, onReset }) {
  const active = Object.values(filters).filter(Boolean).length;
  return (
    <div className="flex flex-wrap gap-2 mb-4 items-center">
      <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
        <Filter size={12} /> Filters:
      </div>
      <select className="input text-xs py-1.5"
        value={filters.source}
        onChange={e => onChange('source', e.target.value)}>
        <option value="">Any Provider</option>
        {Object.entries(SOURCE_NAMES).map(([slug, name]) => (
          <option key={slug} value={slug}>{name}</option>
        ))}
      </select>
      <select className="input text-xs py-1.5"
        value={filters.listing_type}
        onChange={e => onChange('listing_type', e.target.value)}>
        <option value="">Any Type</option>
        <option value="auction">Auction</option>
        <option value="sale">For Sale</option>
      </select>
      <select className="input text-xs py-1.5"
        value={filters.recommendation}
        onChange={e => onChange('recommendation', e.target.value)}>
        <option value="">All Recommendations</option>
        <option value="BID">BID</option>
        <option value="NO BID">NO BID</option>
        <option value="CONDITIONAL">CONDITIONAL</option>
      </select>
      <select className="input text-xs py-1.5"
        value={filters.auction_type}
        onChange={e => onChange('auction_type', e.target.value)}>
        <option value="">Any Auction Type</option>
        <option value="Reserve">Reserve</option>
        <option value="Absolute">Absolute</option>
      </select>
      <select className="input text-xs py-1.5"
        value={filters.property_type}
        onChange={e => onChange('property_type', e.target.value)}>
        <option value="">Any Property Type</option>
        {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input className="input text-xs py-1.5 w-28" placeholder="State (e.g. OH)"
        value={filters.state} onChange={e => onChange('state', e.target.value.toUpperCase())} />
      <input className="input text-xs py-1.5 w-32" type="number" placeholder="Max price $"
        value={filters.max_price} onChange={e => onChange('max_price', e.target.value)} />
      <select className="input text-xs py-1.5"
        value={filters.max_days_to_auction}
        onChange={e => onChange('max_days_to_auction', e.target.value)}>
        <option value="">Any deadline</option>
        <option value="1">Within 24h</option>
        <option value="3">Within 3 days</option>
        <option value="7">Within 7 days</option>
        <option value="30">Within 30 days</option>
      </select>
      <select className="input text-xs py-1.5"
        value={filters.crime_grade}
        onChange={e => onChange('crime_grade', e.target.value)}>
        <option value="">Any crime grade</option>
        {['A+','A','A-','B+','B','B-','C+','C','C-','D','F'].map(g => (
          <option key={g} value={g}>{g}</option>
        ))}
      </select>
      <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer">
        <input type="checkbox" className="accent-brand"
          checked={filters.opportunity_zone}
          onChange={e => onChange('opportunity_zone', e.target.checked ? '1' : '')} />
        Opportunity Zone
      </label>
      {active > 0 && (
        <button onClick={onReset}
          className="btn-ghost flex items-center gap-1 text-xs text-ink-muted"
          title="Clear all filters">
          <X size={12} /> Reset ({active})
        </button>
      )}
    </div>
  );
}

const DEFAULT_FILTERS = {
  asset_class: '', source: '', listing_type: '',
  recommendation: '', auction_type: '', property_type: '',
  state: '', max_price: '', max_days_to_auction: '', crime_grade: '', opportunity_zone: ''
};

export default function ScreeningPage() {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState([{ id: 'bidding_starts', desc: false }]);
  // Sticky — selections survive navigation and reloads (localStorage)
  const [filters, setFilters] = useStickyState('screening-filters', DEFAULT_FILTERS);

  // Only filters drive API re-fetches; sorting is done client-side
  const queryParams = useMemo(() => {
    const p = { limit: 200 };
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters]);

  const { data, loading } = useFetch(() => api.listings.list(queryParams), [JSON.stringify(queryParams)]);
  const rows = data?.data || [];

  const columns = useMemo(() => [
    {
      id: 'address',
      header: 'Property',
      accessorKey: 'address',
      sortingFn: 'alphanumeric',
      cell: ({ row }) => (
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm text-ink font-medium truncate max-w-[180px]">{row.original.address || '—'}</p>
            <SourceBadge source={row.original.source} />
            <MapLinks address={row.original.address} />
          </div>
          <p className="text-xs text-ink-subtle">{row.original.city}, {row.original.state}</p>
        </div>
      ),
    },
    {
      id: 'starting_bid_usd',
      header: 'Price',
      accessorFn: r => r.listing_type === 'sale' ? r.asking_price_usd : r.starting_bid_usd,
      sortingFn: numSortFn,
      cell: ({ getValue, row }) => (
        <div>
          <span className="font-mono text-sm text-ink">{fmt$(getValue())}</span>
          {row.original.listing_type === 'sale' && (
            <p className="text-[10px] text-ink-subtle">asking</p>
          )}
        </div>
      ),
    },
    {
      id: 'max_bid_usd',
      header: 'Max Bid',
      accessorKey: 'max_bid_usd',
      sortingFn: numSortFn,
      cell: ({ getValue }) => <span className="font-mono text-sm text-ink-muted">{fmt$(getValue())}</span>,
    },
    {
      id: 'headroom',
      header: 'Headroom',
      accessorFn: r => (r.max_bid_usd != null && r.starting_bid_usd != null) ? r.max_bid_usd - r.starting_bid_usd : null,
      sortingFn: numSortFn,
      cell: ({ getValue }) => {
        const v = getValue();
        if (v == null) return <span className="text-ink-subtle text-xs">—</span>;
        return <span className={clsx('font-mono text-sm font-medium', v >= 0 ? 'text-bid' : 'text-nobid')}>{fmt$(v)}</span>;
      },
    },
    {
      id: 'bidding_starts',
      header: 'Auction',
      accessorKey: 'bidding_starts',
      sortingFn: 'datetime',
      cell: ({ row }) => {
        if (row.original.listing_type === 'sale') {
          return (
            <div className="space-y-1">
              <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 text-[10px] font-medium">
                For Sale
              </span>
              {row.original.cap_rate_pct != null && (
                <div className="text-[10px] text-ink-subtle font-mono">{row.original.cap_rate_pct}% cap</div>
              )}
            </div>
          );
        }
        const starts = row.original.bidding_starts;
        const ends   = row.original.bidding_ends;
        return (
          <div className="space-y-1">
            <AuctionCountdown date={starts} endDate={ends} compact />
            <div className="text-[10px] text-ink-subtle font-mono space-y-0.5">
              {starts && <div>S: {fmtDate(starts)}</div>}
              {ends   && <div>E: {fmtDate(ends)}</div>}
            </div>
          </div>
        );
      },
    },
    {
      id: 'square_footage',
      header: 'Size',
      accessorKey: 'square_footage',
      sortingFn: numSortFn,
      cell: ({ row }) => {
        const r = row.original;
        if (r.asset_class === 'residential') {
          const parts = [];
          if (r.beds != null)  parts.push(`${r.beds} bd`);
          if (r.baths != null) parts.push(`${r.baths} ba`);
          if (r.living_area_sqft != null) parts.push(fmtSF(r.living_area_sqft));
          return <span className="text-xs text-ink-muted">{parts.length ? parts.join(' · ') : '—'}</span>;
        }
        return <span className="text-xs text-ink-muted">{fmtSF(r.square_footage)}</span>;
      },
    },
    {
      id: 'crime_grade',
      header: 'Crime',
      accessorKey: 'crime_grade',
      sortingFn: gradeSortFn,
      cell: ({ getValue }) => <CrimeGradeBadge grade={getValue()} />,
    },
    {
      id: 'avg_retail_rent',
      header: 'Retail $/SF',
      accessorKey: 'avg_retail_rent',
      sortingFn: numSortFn,
      cell: ({ getValue }) => (
        <span className="text-xs text-ink-muted font-mono">
          {getValue() != null ? `$${Number(getValue()).toFixed(2)}` : '—'}
        </span>
      ),
    },
    {
      id: 'disposition_score',
      header: 'Disp.',
      accessorKey: 'disposition_score',
      sortingFn: numSortFn,
      cell: ({ getValue }) => {
        const v = getValue();
        const color = v >= 7 ? 'text-bid' : v >= 5 ? 'text-conditional' : v != null ? 'text-nobid' : 'text-ink-subtle';
        return <span className={clsx('text-sm font-bold font-mono', color)}>{v != null ? v.toFixed(1) : '—'}</span>;
      },
    },
    {
      id: 'recommendation',
      header: 'Decision',
      accessorKey: 'recommendation',
      sortingFn: recSortFn,
      cell: ({ getValue }) => <RecommendationBadge value={getValue()} />,
    },
    {
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <button onClick={e => { e.stopPropagation(); navigate(`/listing/${row.original.id}`); }}
          className="p-1.5 rounded hover:bg-surface-hover text-ink-subtle hover:text-brand transition-colors">
          <ExternalLink size={14} />
        </button>
      ),
    },
  ], [navigate]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel:     getCoreRowModel(),
    getSortedRowModel:   getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Client-side sorting — custom sortingFns handle nulls and grade rank correctly
  });

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div className="p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Screening</h1>
          <p className="text-sm text-ink-subtle mt-0.5">{data?.total ?? '…'} listings</p>
        </div>
        <AssetClassTabs value={filters.asset_class} onChange={v => setFilter('asset_class', v)} />
      </div>

      <FilterBar filters={filters} onChange={setFilter} onReset={() => setFilters(DEFAULT_FILTERS)} />

      {loading ? <Spinner /> : rows.length === 0 ? <EmptyState message="No listings match your filters" /> : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map(hg => (
                  <tr key={hg.id} className="border-b border-surface-border">
                    {hg.headers.map(header => (
                      <th key={header.id}
                        className={clsx(
                          'px-4 py-3 text-left text-xs font-semibold text-ink-subtle uppercase tracking-wider whitespace-nowrap',
                          header.column.getCanSort() && 'cursor-pointer select-none hover:text-ink'
                        )}
                        onClick={header.column.getToggleSortingHandler()}>
                        <div className="flex items-center gap-1">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getIsSorted() === 'asc'  && <ChevronUp size={12} />}
                          {header.column.getIsSorted() === 'desc' && <ChevronDown size={12} />}
                        </div>
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row, i) => (
                  <tr key={row.id}
                    className={clsx(
                      'border-b border-surface-border/50 hover:bg-surface-hover transition-colors cursor-pointer',
                      i % 2 === 0 ? '' : 'bg-surface-card/30'
                    )}
                    onClick={() => navigate(`/listing/${row.original.id}`)}>
                    {row.getVisibleCells().map(cell => (
                      <td key={cell.id} className="px-4 py-3 whitespace-nowrap">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
