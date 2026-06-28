import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, ExternalLink, RefreshCw, AlertTriangle, TrendingUp, Shield, ShoppingBag, Users } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { RecommendationBadge, CrimeGradeBadge, AuctionCountdown, Spinner } from '../components/index.js';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';

const fmt$  = v => v != null ? `$${Number(v).toLocaleString()}` : '—';
const fmtPct = v => v != null ? `${v}%` : '—';
const row   = (label, value) => (
  <div key={label} className="flex justify-between items-start py-2 border-b border-surface-border/50 last:border-0 gap-4">
    <span className="text-xs text-ink-subtle shrink-0">{label}</span>
    <span className="text-xs text-ink text-right">{value ?? '—'}</span>
  </div>
);

const TABS = ['Overview', 'Auction Terms', 'Property', 'Market Intelligence', 'Due Diligence', 'Compliance'];

export default function PropertyDetail() {
  const { id }    = useParams();
  const navigate  = useNavigate();
  const [tab, setTab] = useState('Overview');
  const [enriching, setEnriching] = useState(false);

  const { data: listing, loading, reload } = useFetch(() => api.listings.get(id), [id]);

  async function handleEnrich() {
    setEnriching(true);
    try { await api.listings.enrich(id); setTimeout(reload, 3000); }
    finally { setTimeout(() => setEnriching(false), 2000); }
  }

  if (loading) return <Spinner />;
  if (!listing) return <div className="p-8 text-ink-subtle">Listing not found.</div>;

  const demo   = listing.enrichment_demographics || {};
  const crime  = listing.enrichment_crime        || {};
  const retail = listing.enrichment_retail       || {};
  const dd     = listing.due_diligence           || null;
  const cr     = listing.compliance_review       || null;

  const dispositionData = dd?.disposition_score_breakdown
    ? Object.entries(dd.disposition_score_breakdown).map(([k, v]) => ({
        subject: k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
        score:   v,
      }))
    : [];

  return (
    <div className="min-h-full">
      {/* Top bar */}
      <div className="sticky top-0 z-10 bg-surface/90 backdrop-blur border-b border-surface-border px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="btn-ghost p-1.5">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-base font-semibold text-ink leading-tight">{listing.title || listing.address}</h1>
            <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
              <MapPin size={10} />
              {listing.address}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RecommendationBadge value={listing.recommendation} size="lg" />
          <button onClick={handleEnrich} disabled={enriching}
            className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-50">
            <RefreshCw size={12} className={enriching ? 'animate-spin' : ''} />
            {enriching ? 'Enriching…' : 'Re-enrich'}
          </button>
          {listing.url && (
            <a href={listing.url} target="_blank" rel="noreferrer" className="btn-ghost flex items-center gap-1.5 text-xs">
              <ExternalLink size={12} /> Crexi
            </a>
          )}
        </div>
      </div>

      {/* Hero stats */}
      <div className="px-6 py-5 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 border-b border-surface-border">
        {[
          ['Starting Bid',    fmt$(listing.starting_bid_usd),  'text-ink'],
          ['Max Bid',         fmt$(listing.max_bid_usd),        dd ? 'text-bid' : 'text-ink-subtle'],
          ['Bid Headroom',    listing.max_bid_usd != null && listing.starting_bid_usd != null
            ? fmt$(listing.max_bid_usd - listing.starting_bid_usd)
            : '—',
            (listing.max_bid_usd - listing.starting_bid_usd) >= 0 ? 'text-bid' : 'text-nobid'],
          ['Disposition',     dd?.disposition_score != null ? `${dd.disposition_score}/10` : '—',
            dd?.disposition_score >= 7 ? 'text-bid' : dd?.disposition_score >= 5 ? 'text-conditional' : 'text-ink-subtle'],
          ['Crime Grade',     listing.crime_grade || '—',       'text-ink'],
          ['Avg Retail Rent', listing.avg_retail_rent != null ? `$${Number(listing.avg_retail_rent).toFixed(2)}/SF` : '—', 'text-ink-muted'],
        ].map(([label, value, color]) => (
          <div key={label} className="card p-3">
            <p className="text-[10px] text-ink-subtle uppercase tracking-wider mb-1">{label}</p>
            <p className={clsx('text-lg font-bold font-mono', color)}>{value}</p>
          </div>
        ))}
      </div>

      {/* Auction countdown */}
      {listing.bidding_starts && (
        <div className="px-6 py-3 border-b border-surface-border flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-ink-subtle">
            <Calendar size={12} /> Auction starts
          </div>
          <AuctionCountdown date={listing.bidding_starts} />
          <span className="text-xs text-ink-subtle">
            {listing.bidding_starts ? format(new Date(listing.bidding_starts), 'MMM d, yyyy h:mm a') : ''}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-surface-border px-6 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={clsx(
              'px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors',
              tab === t
                ? 'border-brand text-brand font-medium'
                : 'border-transparent text-ink-muted hover:text-ink'
            )}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="p-6 max-w-5xl">

        {tab === 'Overview' && (
          <div className="space-y-5">
            {listing.description && (
              <div className="card p-5">
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-3">Description</h3>
                <p className="text-sm text-ink-muted leading-relaxed">{listing.description}</p>
              </div>
            )}
            {listing.investment_highlights && (
              <div className="card p-5">
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-3">Investment Highlights</h3>
                <p className="text-sm text-ink-muted leading-relaxed whitespace-pre-line">{listing.investment_highlights}</p>
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="card p-4">
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-3">Quick Facts</h3>
                {row('Property Type', Array.isArray(listing.property_types) ? listing.property_types.join(', ') : listing.property_types)}
                {row('Square Footage', listing.square_footage ? `${Number(listing.square_footage).toLocaleString()} SF` : null)}
                {row('Year Built', listing.year_built)}
                {row('Acreage', listing.acreage ? `${listing.acreage} acres` : null)}
                {row('Zoning', listing.zoning)}
                {row('Tenancy', listing.tenancy)}
                {row('Opportunity Zone', listing.opportunity_zone ? 'Yes' : 'No')}
              </div>
              <div className="card p-4">
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-3">Pipeline</h3>
                {row('Stage', listing.pipeline_stage)}
                {row('Scraped', listing.scraped_at ? format(new Date(listing.scraped_at), 'MMM d, yyyy') : null)}
                {row('Enriched', listing.enriched_at ? format(new Date(listing.enriched_at), 'MMM d, yyyy') : 'Not yet')}
                {row('Auction Type', listing.auction_type)}
                {row('Reserve Met', listing.reserve_met ? 'Yes' : 'No')}
                {row('Listed By', listing.brokerage)}
              </div>
            </div>
          </div>
        )}

        {tab === 'Auction Terms' && (
          <div className="card p-5 max-w-lg">
            <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-4">Auction Terms</h3>
            {row('Auction Type',         listing.auction_type)}
            {row('Starting Bid',         fmt$(listing.starting_bid_usd))}
            {row('Bid Increment',        fmt$(listing.bid_increment_usd))}
            {row('Bidding Starts',       listing.bidding_starts ? format(new Date(listing.bidding_starts), 'MMM d, yyyy h:mm a') : null)}
            {row('Bidding Ends',         listing.bidding_ends   ? format(new Date(listing.bidding_ends),   'MMM d, yyyy h:mm a') : null)}
            {row('Reserve Met',          listing.reserve_met ? 'Yes — will sell' : 'Not yet')}
            {row('Participation Deposit',listing.participation_deposit)}
            {row('Earnest Money',        listing.earnest_money_deposit)}
            {row('Marketing Fee',        listing.marketing_fee_pct)}
            {row('Min Marketing Fee',    fmt$(listing.minimum_marketing_fee_usd))}
            {row('Closing Period',       listing.closing_period_days ? `${listing.closing_period_days} days` : null)}
            {row('Non-Contingent',       listing.non_contingent ? 'Yes' : 'No')}
          </div>
        )}

        {tab === 'Property' && (
          <div className="card p-5 max-w-lg">
            <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-4">Property Details</h3>
            {row('APN',            listing.apn)}
            {row('Address',        listing.address)}
            {row('City / State',   `${listing.city}, ${listing.state} ${listing.zip}`)}
            {row('Property Types', Array.isArray(listing.property_types) ? listing.property_types.join(', ') : listing.property_types)}
            {row('Sub Types',      Array.isArray(listing.sub_types) ? listing.sub_types.join(', ') : listing.sub_types)}
            {row('Square Footage', listing.square_footage ? `${Number(listing.square_footage).toLocaleString()} SF` : null)}
            {row('Year Built',     listing.year_built)}
            {row('Stories',        listing.stories)}
            {row('Buildings',      listing.buildings)}
            {row('Acreage',        listing.acreage ? `${listing.acreage} acres` : null)}
            {row('Zoning',         listing.zoning)}
            {row('Tenancy',        listing.tenancy)}
            {row('Opportunity Zone', listing.opportunity_zone ? 'Yes' : 'No')}
          </div>
        )}

        {tab === 'Market Intelligence' && (
          <div className="space-y-5">
            {/* Demographics */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Users size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Demographics</h3>
                {demo.source && <span className="text-[10px] text-ink-subtle ml-auto">{demo.source} · {demo.data_year}</span>}
              </div>
              {Object.keys(demo).length === 0
                ? <p className="text-sm text-ink-subtle">Not yet enriched. Click Re-enrich above.</p>
                : (
                  <div className="grid grid-cols-2 gap-x-8">
                    <div>
                      {row('Population',       demo.population?.toLocaleString())}
                      {row('Population Density', demo.population_density_per_sq_mi ? `${demo.population_density_per_sq_mi}/sq mi` : null)}
                      {row('Median Age',       demo.median_age)}
                      {row('Married',          demo.married_pct)}
                      {row('Families w/ Kids', demo.families_with_kids_pct)}
                      {row('Livability Score', demo.livability_score)}
                    </div>
                    <div>
                      {row('White',                 demo.race_ethnicity?.white)}
                      {row('Black / African Am.',   demo.race_ethnicity?.black_or_african_american)}
                      {row('Hispanic / Latino',     demo.race_ethnicity?.hispanic_or_latino)}
                      {row('Asian',                 demo.race_ethnicity?.asian)}
                      {row('HH Below $25k',         demo.income?.pct_households_below_25k)}
                      {row('HH Above $150k',        demo.income?.pct_households_above_150k)}
                      {row('Foreign Born',          demo.foreign_born_pct)}
                    </div>
                  </div>
                )}
            </div>

            {/* Crime */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Shield size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Crime Statistics</h3>
                {crime.source && <span className="text-[10px] text-ink-subtle ml-auto">{crime.source} · {crime.data_year}</span>}
              </div>
              {Object.keys(crime).length === 0
                ? <p className="text-sm text-ink-subtle">Not yet enriched.</p>
                : (
                  <div>
                    <div className="flex items-center gap-3 mb-4">
                      <CrimeGradeBadge grade={crime.overall_grade} />
                      {crime.crime_rate_summary && <p className="text-xs text-ink-muted">{crime.crime_rate_summary}</p>}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-surface-border text-ink-subtle">
                            <th className="text-left py-2 font-medium">Crime Type</th>
                            <th className="text-right py-2 font-medium">Incidents</th>
                            <th className="text-right py-2 font-medium">City /100k</th>
                            <th className="text-right py-2 font-medium">State /100k</th>
                            <th className="text-right py-2 font-medium">National /100k</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(crime.incidents_per_100k || {}).map(([type, stats]) => stats && (
                            <tr key={type} className="border-b border-surface-border/40">
                              <td className="py-1.5 capitalize">{type.replace(/_/g, ' ')}</td>
                              <td className="text-right text-ink">{stats.city_incidents}</td>
                              <td className="text-right text-ink">{stats.city_per_100k}</td>
                              <td className="text-right text-ink-muted">{stats.state_per_100k}</td>
                              <td className="text-right text-ink-subtle">{stats.national_per_100k}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </div>

            {/* Retail Market */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <ShoppingBag size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Retail Market</h3>
                {retail.source && <span className="text-[10px] text-ink-subtle ml-auto">{retail.source}</span>}
              </div>
              {Object.keys(retail).length === 0
                ? <p className="text-sm text-ink-subtle">Not yet enriched.</p>
                : (
                  <div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        ['Avg $/SF/yr', retail.retail_asking_rent?.avg_per_sf_yr != null ? `$${Number(retail.retail_asking_rent.avg_per_sf_yr).toFixed(2)}` : '—'],
                        ['Min $/SF/yr', retail.retail_asking_rent?.min_per_sf_yr != null ? `$${Number(retail.retail_asking_rent.min_per_sf_yr).toFixed(2)}` : '—'],
                        ['Max $/SF/yr', retail.retail_asking_rent?.max_per_sf_yr != null ? `$${Number(retail.retail_asking_rent.max_per_sf_yr).toFixed(2)}` : '—'],
                      ].map(([l, v]) => (
                        <div key={l} className="bg-surface-hover rounded-lg p-3">
                          <p className="text-[10px] text-ink-subtle uppercase tracking-wider mb-1">{l}</p>
                          <p className="text-lg font-bold font-mono text-ink">{v}</p>
                        </div>
                      ))}
                    </div>
                    {retail.all_priced_leases?.length > 0 && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-surface-border text-ink-subtle">
                              <th className="text-left py-2 font-medium">Address</th>
                              <th className="text-right py-2 font-medium">$/SF/yr</th>
                              <th className="text-right py-2 font-medium">Size</th>
                              <th className="text-right py-2 font-medium">Type</th>
                            </tr>
                          </thead>
                          <tbody>
                            {retail.all_priced_leases.map((c, i) => (
                              <tr key={i} className="border-b border-surface-border/40">
                                <td className="py-1.5 text-ink max-w-[200px] truncate">{c.address}</td>
                                <td className="text-right font-mono text-bid">${c.asking_per_sf_yr?.toFixed(2)}</td>
                                <td className="text-right text-ink-muted">{c.size_sf_range} SF</td>
                                <td className="text-right text-ink-subtle">{c.property_type}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
            </div>
          </div>
        )}

        {tab === 'Due Diligence' && (
          <div className="space-y-5">
            {!dd ? (
              <div className="card p-8 text-center">
                <TrendingUp size={32} className="text-ink-subtle mx-auto mb-3" strokeWidth={1.2} />
                <p className="text-sm text-ink-muted">Due diligence has not been run for this listing.</p>
                <p className="text-xs text-ink-subtle mt-1">This analysis requires the Due Diligence Agent (see backlog).</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <RecommendationBadge value={dd.recommendation} size="lg" />
                  <p className="text-sm text-ink-muted">{dd.max_bid_reasoning}</p>
                </div>
                <div className="grid grid-cols-2 gap-5">
                  <div className="card p-5">
                    <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-4">Financial Model</h3>
                    {row('Max Bid',                   fmt$(dd.max_bid_usd))}
                    {row('All-In Cost',                fmt$(dd.financial_model?.all_in_cost_usd))}
                    {row('Estimated NOI',              fmt$(dd.financial_model?.estimated_noi_usd))}
                    {row('Required CoC Return',        fmtPct(dd.financial_model?.required_coc_return_pct))}
                    {row('Loan Amount',                fmt$(dd.financial_model?.loan_amount_usd))}
                    {row('Required Equity',            fmt$(dd.financial_model?.required_equity_usd))}
                    {row("Buyer's Premium",            fmt$(dd.financial_model?.buyers_premium_usd))}
                    {row('Lien Payoffs',               fmt$(dd.financial_model?.lien_payoffs_usd))}
                    {row('Capex Reserve',              fmt$(dd.financial_model?.capex_reserve_usd))}
                    {row('6-Month Op. Reserve',        fmt$(dd.financial_model?.six_month_operating_reserve_usd))}
                    {row('Closing Costs',              fmt$(dd.financial_model?.closing_costs_usd))}
                  </div>
                  <div className="card p-5">
                    <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-2">
                      Disposition Score — {dd.disposition_score?.toFixed(1)}/10
                    </h3>
                    {dispositionData.length > 0 && (
                      <ResponsiveContainer width="100%" height={220}>
                        <RadarChart data={dispositionData}>
                          <PolarGrid stroke="#334155" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                          <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} strokeWidth={2} />
                          <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }} />
                        </RadarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
                {dd.risk_flags?.length > 0 && (
                  <div className="card p-5">
                    <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider mb-3 flex items-center gap-2">
                      <AlertTriangle size={13} className="text-conditional" /> Risk Flags
                    </h3>
                    <ul className="space-y-2">
                      {dd.risk_flags.map((f, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-ink-muted">
                          <span className="w-1.5 h-1.5 rounded-full bg-conditional mt-1.5 shrink-0" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {tab === 'Compliance' && (
          <div className="space-y-5">
            {!cr ? (
              <div className="card p-8 text-center">
                <Shield size={32} className="text-ink-subtle mx-auto mb-3" strokeWidth={1.2} />
                <p className="text-sm text-ink-muted">Compliance review has not been run for this listing.</p>
                <p className="text-xs text-ink-subtle mt-1">This analysis requires the Government Compliance Agent (see backlog).</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    ['Overall Status',    cr.overall_status,     ''],
                    ['Est. Repair Cost',  fmt$(cr.estimated_immediate_repair_cost?.high_usd), 'text-nobid'],
                    ['Est. License Cost', fmt$(cr.estimated_licensing_cost?.high_usd), 'text-conditional'],
                  ].map(([l, v, c]) => (
                    <div key={l} className="card p-4">
                      <p className="text-[10px] text-ink-subtle uppercase tracking-wider mb-1">{l}</p>
                      <p className={clsx('text-base font-bold', c || 'text-ink')}>{v}</p>
                    </div>
                  ))}
                </div>
                {cr.domains && Object.entries(cr.domains).map(([domain, d]) => (
                  <div key={domain} className="card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-medium text-ink capitalize">{domain.replace(/_/g, ' ')}</h4>
                      <span className={clsx('badge text-[10px]',
                        d.status === 'COMPLIANT' ? 'bg-bid-bg text-bid' :
                        d.status === 'LIKELY COMPLIANT' ? 'bg-sky-900/50 text-sky-400' :
                        d.status === 'DEFICIENCY SUSPECTED' ? 'bg-conditional-bg text-conditional' :
                        'bg-nobid-bg text-nobid')}>
                        {d.status}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted mb-2">{d.finding}</p>
                    {d.code_ref && <p className="text-[10px] text-ink-subtle font-mono">§ {d.code_ref}</p>}
                    {d.estimated_cost && (
                      <p className="text-xs text-conditional mt-1">
                        Est. cost: ${d.estimated_cost.low_usd?.toLocaleString()} – ${d.estimated_cost.high_usd?.toLocaleString()}
                        {d.estimated_cost.notes && ` · ${d.estimated_cost.notes}`}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
