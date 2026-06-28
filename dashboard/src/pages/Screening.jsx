import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, flexRender,
} from '@tanstack/react-table';
import { ChevronUp, ChevronDown, ExternalLink, Filter } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { RecommendationBadge, CrimeGradeBadge, AuctionCountdown, Spinner, EmptyState } from '../components/index.js';

const fmt$ = v => v != null ? `$${Number(v).toLocaleString()}` : '—';
const fmtSF = v => v != null ? `${Number(v).toLocaleString()} SF` : '—';

function FilterBar({ filters, onChange }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
        <Filter size={12} /> Filters:
      </div>
      <select className="input text-xs py-1.5"
        value={filters.recommendation}
        onChange={e => onChange('recommendation', e.target.value)}>
        <option value="">All Recommendations</option>
        <option value="BID">BID</option>
        <option value="NO BID">NO BID</option>
        <option value="CONDITIONAL">CONDITIONAL</option>
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
    </div>
  );
}

export default function ScreeningPage() {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState([{ id: 'bidding_starts', desc: false }]);
  const [filters, setFilters] = useState({
    recommendation: '', state: '', max_price: '', max_days_to_auction: '', crime_grade: '', opportunity_zone: ''
  });

  const queryParams = useMemo(() => {
    const p = { limit: 100, sort: sorting[0]?.id || 'bidding_starts', dir: sorting[0]?.desc ? 'desc' : 'asc' };
    Object.entries(filters).forEach(([k, v]) => { if (v) p[k] = v; });
    return p;
  }, [filters, sorting]);

  const { data, loading } = useFetch(() => api.listings.list(queryParams), [JSON.stringify(queryParams)]);

  const rows = data?.data || [];

  const columns = useMemo(() => [
    {
      id: 'address',
      header: 'Property',
      accessorKey: 'address',
      cell: ({ row }) => (
        <div>
          <p className="text-sm text-ink font-medium truncate max-w-[220px]">{row.original.address || '—'}</p>
          <p className="text-xs text-ink-subtle">{row.original.city}, {row.original.state}</p>
        </div>
      ),
    },
    {
      id: 'starting_bid_usd',
      header: 'Starting Bid',
      accessorKey: 'starting_bid_usd',
      cell: ({ getValue }) => <span className="font-mono text-sm text-ink">{fmt$(getValue())}</span>,
    },
    {
      id: 'max_bid_usd',
      header: 'Max Bid',
      accessorKey: 'max_bid_usd',
      cell: ({ getValue }) => <span className="font-mono text-sm text-ink-muted">{fmt$(getValue())}</span>,
    },
    {
      id: 'headroom',
      header: 'Headroom',
      accessorFn: r => (r.max_bid_usd != null && r.starting_bid_usd != null) ? r.max_bid_usd - r.starting_bid_usd : null,
      cell: ({ getValue }) => {
        const v = getValue();
        if (v == null) return <span className="text-ink-subtle text-xs">—</span>;
        return <span className={clsx('font-mono text-sm font-medium', v >= 0 ? 'text-bid' : 'text-nobid')}>{fmt$(v)}</span>;
      },
      enableSorting: false,
    },
    {
      id: 'bidding_starts',
      header: 'Auction',
      accessorKey: 'bidding_starts',
      cell: ({ getValue }) => <AuctionCountdown date={getValue()} compact />,
    },
    {
      id: 'square_footage',
      header: 'Size',
      accessorKey: 'square_footage',
      cell: ({ getValue }) => <span className="text-xs text-ink-muted">{fmtSF(getValue())}</span>,
    },
    {
      id: 'crime_grade',
      header: 'Crime',
      accessorKey: 'crime_grade',
      cell: ({ getValue }) => <CrimeGradeBadge grade={getValue()} />,
    },
    {
      id: 'avg_retail_rent',
      header: 'Retail $/SF',
      accessorKey: 'avg_retail_rent',
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
      cell: ({ getValue }) => <RecommendationBadge value={getValue()} />,
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <button onClick={() => navigate(`/listing/${row.original.id}`)}
          className="p-1.5 rounded hover:bg-surface-hover text-ink-subtle hover:text-brand transition-colors">
          <ExternalLink size={14} />
        </button>
      ),
      enableSorting: false,
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
    manualSorting: true,
  });

  const setFilter = (k, v) => setFilters(f => ({ ...f, [k]: v }));

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink">Screening</h1>
        <p className="text-sm text-ink-subtle mt-0.5">{data?.total ?? '…'} listings</p>
      </div>

      <FilterBar filters={filters} onChange={setFilter} />

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
