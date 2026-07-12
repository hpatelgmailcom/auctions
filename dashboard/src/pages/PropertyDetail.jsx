import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, ExternalLink, RefreshCw, AlertTriangle, TrendingUp, Shield, ShoppingBag, Users, Footprints, GraduationCap, CloudRain, BarChart2 } from 'lucide-react';
import { format } from 'date-fns';
import clsx from 'clsx';
import { useFetch } from '../hooks/useFetch.js';
import { api } from '../api/client.js';
import { RecommendationBadge, CrimeGradeBadge, AuctionCountdown, Spinner, MapLinks } from '../components/index.js';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer, Tooltip } from 'recharts';

const fmt$  = v => v != null ? `$${Number(v).toLocaleString()}` : '—';
const fmtPct = v => v != null ? `${v}%` : '—';

const SOURCE_LABEL = { crexi: 'Crexi', auction_com: 'Auction.com' };

// MapLinks imported from components/MapLinks.jsx
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
  const sold   = listing.enrichment_sold_comps   || null;
  const walk   = listing.enrichment_walk_score   || null;
  const school = listing.enrichment_schools      || null;
  const flood  = listing.enrichment_flood_risk   || null;
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
              <ExternalLink size={12} /> {SOURCE_LABEL[listing.source] || 'Source'}
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
            {row('Address',        listing.address)}
            {row('City / State',   `${listing.city}, ${listing.state} ${listing.zip}`)}
            {listing.asset_class === 'residential' ? (
              <>
                {row('Home Type',      listing.home_type)}
                {row('Occupancy',      listing.occupancy_status)}
                {row('Beds',           listing.beds)}
                {row('Baths',          listing.baths)}
                {row('Living Area',    listing.living_area_sqft ? `${Number(listing.living_area_sqft).toLocaleString()} SF` : null)}
                {row('Year Built',     listing.year_built)}
              </>
            ) : (
              <>
                {row('APN',            listing.apn)}
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
              </>
            )}
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
                : (() => {
                    // Normalize across Census (zip-level) and Areavibes (city-level) schemas
                    const isCensus  = demo.source?.includes('Census');
                    const pop       = demo.population?.total ?? demo.population;
                    const density   = demo.population?.density_per_sq_mi ?? demo.population_density_per_sq_mi;
                    const medAge    = demo.median_age?.total ?? demo.median_age;
                    const medAgeM   = demo.median_age?.male;
                    const medAgeF   = demo.median_age?.female;
                    const married   = demo.household?.married_pct   ?? demo.married_pct;
                    const families  = demo.household?.families_with_kids_pct ?? demo.families_with_kids_pct;
                    const race      = demo.race_ethnicity || {};
                    const white     = race.white_alone    ?? race.white;
                    const black     = race.black_or_african_american;
                    const hispanic  = race.hispanic_or_latino;
                    const asian     = race.asian_alone    ?? race.asian;
                    const medIncome = demo.income?.median_household_usd;
                    const below25k  = demo.income?.pct_households_below_25k;
                    const above100k = demo.income?.pct_households_above_100k;
                    const above200k = demo.income?.pct_households_above_200k;
                    const povRate   = demo.poverty?.poverty_rate;
                    const unemp     = demo.employment?.unemployment_rate;
                    const hsPlus    = demo.education?.high_school_or_higher_pct;
                    const bachPlus  = demo.education?.bachelors_or_higher_pct;
                    const foreign   = demo.foreign_born_pct;
                    const medHome   = demo.housing?.median_home_value_usd;
                    const livability = demo.livability_score;

                    return (
                      <div className="grid grid-cols-2 gap-x-8">
                        <div>
                          {row('Population',       pop?.toLocaleString())}
                          {density && row('Pop. Density', `${Number(density).toLocaleString()}/sq mi`)}
                          {row('Median Age',       medAge != null ? `${medAge}${medAgeM ? ` (M: ${medAgeM} / F: ${medAgeF})` : ''}` : null)}
                          {married    && row('Married (15+)',     married)}
                          {families   && row('Families w/ Kids',  families)}
                          {medIncome  && row('Median HH Income',  `$${Number(medIncome).toLocaleString()}`)}
                          {medHome    && row('Median Home Value',  `$${Number(medHome).toLocaleString()}`)}
                          {povRate    && row('Poverty Rate',       povRate)}
                          {unemp      && row('Unemployment',       unemp)}
                          {livability && row('Livability Score',   livability)}
                        </div>
                        <div>
                          {white    && row('White',               white)}
                          {black    && row('Black / African Am.', black)}
                          {hispanic && row('Hispanic / Latino',   hispanic)}
                          {asian    && row('Asian',               asian)}
                          {below25k  && row('HH Below $25k',      below25k)}
                          {above100k && row('HH Above $100k',     above100k)}
                          {above200k && row('HH Above $200k',     above200k)}
                          {hsPlus    && row('HS or Higher',        hsPlus)}
                          {bachPlus  && row("Bachelor's+",         bachPlus)}
                          {foreign   && row('Foreign Born',        foreign)}
                        </div>
                      </div>
                    );
                  })()}
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
                    {/* Data tier badge */}
                    {retail.search_tier_label && (
                      <div className={clsx(
                        'flex items-center gap-2 rounded-lg px-3 py-2 mb-4 text-xs',
                        retail.search_tier === 1
                          ? 'bg-bid-bg text-bid'
                          : retail.search_tier === 2
                            ? 'bg-sky-900/40 text-sky-400'
                            : 'bg-conditional-bg text-conditional'
                      )}>
                        <AlertTriangle size={11} className={retail.search_tier === 1 ? 'hidden' : ''} />
                        <span>
                          <strong>Tier {retail.search_tier} data</strong> — {retail.search_tier_label}
                          {retail.search_tier > 1 && ' (local market too thin; wider area used as proxy)'}
                        </span>
                      </div>
                    )}
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
                              <th className="py-2 font-medium w-12"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {retail.all_priced_leases.map((c, i) => (
                              <tr key={i} className="border-b border-surface-border/40">
                                <td className="py-1.5 text-ink max-w-[200px] truncate">{c.address}</td>
                                <td className="text-right font-mono text-bid">${c.asking_per_sf_yr?.toFixed(2)}</td>
                                <td className="text-right text-ink-muted">{c.size_sf_range} SF</td>
                                <td className="text-right text-ink-subtle">{c.property_type}</td>
                                <td className="py-1.5"><MapLinks address={c.address} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
            </div>

            {/* Walk Score */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <Footprints size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Walkability</h3>
                {walk?.status === 'key_required' && <span className="text-[10px] text-conditional ml-auto">API key required</span>}
              </div>
              {!walk ? <p className="text-sm text-ink-subtle">Not yet enriched.</p>
                : walk.status === 'key_required' ? <p className="text-sm text-ink-subtle">{walk.message}</p>
                : (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      ['Walk Score', walk.walk_score, walk.walk_label],
                      ['Transit Score', walk.transit_score, walk.transit_label],
                      ['Bike Score', walk.bike_score, walk.bike_label],
                    ].map(([label, score, desc]) => (
                      <div key={label} className="bg-surface-hover rounded-lg p-3">
                        <p className="text-[10px] text-ink-subtle uppercase tracking-wider mb-1">{label}</p>
                        <p className={clsx('text-2xl font-bold font-mono',
                          score >= 70 ? 'text-bid' : score >= 50 ? 'text-conditional' : score != null ? 'text-nobid' : 'text-ink-subtle')}>
                          {score ?? '—'}
                        </p>
                        {desc && <p className="text-[10px] text-ink-subtle mt-1">{desc}</p>}
                      </div>
                    ))}
                  </div>
                )}
            </div>

            {/* Schools */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <GraduationCap size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Schools</h3>
                {school?.source && <span className="text-[10px] text-ink-subtle ml-auto">{school.source}</span>}
              </div>
              {!school ? <p className="text-sm text-ink-subtle">Not yet enriched.</p> : (
                <div className="grid grid-cols-2 gap-x-8">
                  <div>
                    {row('District Grade', school.grade)}
                    {row('Avg Test Scores (city)', school.test_scores?.city_percentile != null ? `${school.test_scores.city_percentile}th percentile` : null)}
                    {row('Avg Test Scores (national)', school.test_scores?.national_avg_pct != null ? `${school.test_scores.national_avg_pct}th percentile` : null)}
                    {row('Student/Teacher Ratio', school.student_teacher_ratio?.city)}
                  </div>
                  <div>
                    {row('Public Schools', school.school_counts?.public)}
                    {row('Private Schools', school.school_counts?.private)}
                    {row('Post-Secondary', school.school_counts?.post_secondary ?? 'n/a')}
                  </div>
                </div>
              )}
            </div>

            {/* Flood & Climate Risk */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <CloudRain size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Flood & Climate Risk</h3>
                {flood?.source && <span className="text-[10px] text-ink-subtle ml-auto">{flood.source}</span>}
              </div>
              {!flood ? <p className="text-sm text-ink-subtle">Not yet enriched.</p> : (
                <div>
                  <div className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 mb-4 text-sm',
                    flood.flood_zone?.risk_level === 'Minimal' ? 'bg-bid-bg text-bid' :
                    flood.flood_zone?.risk_level === 'Moderate' ? 'bg-conditional-bg text-conditional' :
                    flood.flood_zone?.risk_level === 'High' || flood.flood_zone?.risk_level === 'Very High' ? 'bg-nobid-bg text-nobid' :
                    'bg-surface-hover text-ink-muted')}>
                    <CloudRain size={14} />
                    <span>
                      <strong>Zone {flood.flood_zone?.zone ?? '—'}</strong> — {flood.flood_zone?.description ?? 'Unknown'}
                    </span>
                  </div>
                  {row('In Special Flood Hazard Area', flood.flood_zone?.in_special_flood_hazard_area ? 'Yes — insurance required' : 'No')}
                  {row('Risk Level', flood.flood_zone?.risk_level)}
                  {row('Zone Subtype', flood.flood_zone?.zone_subtype)}
                  {flood.flood_zone?.base_flood_elevation && row('Base Flood Elevation', `${flood.flood_zone.base_flood_elevation} ft`)}
                  {flood.climate_info && row('NWS Forecast Zone', flood.climate_info.forecast_zone)}
                  {flood.climate_info && row('Radar Station', flood.climate_info.radar_station)}
                  {flood.insurance_note && <p className="text-xs text-ink-subtle mt-3 italic">{flood.insurance_note}</p>}
                </div>
              )}
            </div>

            {/* Sold Comps */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 size={14} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink-subtle uppercase tracking-wider">Sold Comps</h3>
                {sold?.scope && <span className="text-[10px] text-ink-subtle ml-auto">{sold.scope}</span>}
              </div>
              {!sold ? <p className="text-sm text-ink-subtle">{listing.asset_class === 'residential' ? 'Sold comps are a commercial-only data source.' : 'Not yet enriched.'}</p>
                : sold.total_comps === 0 ? <p className="text-sm text-ink-subtle">No sold comps found for this area and property type.</p>
                : (
                  <div>
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      {[
                        ['Avg Sale Price', fmt$(sold.avg_sale_price)],
                        ['Min Sale Price', fmt$(sold.min_sale_price)],
                        ['Max Sale Price', fmt$(sold.max_sale_price)],
                      ].map(([l, v]) => (
                        <div key={l} className="bg-surface-hover rounded-lg p-3">
                          <p className="text-[10px] text-ink-subtle uppercase tracking-wider mb-1">{l}</p>
                          <p className="text-lg font-bold font-mono text-ink">{v}</p>
                        </div>
                      ))}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-surface-border text-ink-subtle">
                            <th className="text-left py-2 font-medium">Address</th>
                            <th className="text-right py-2 font-medium">Sale Price</th>
                            <th className="text-right py-2 font-medium">SF</th>
                            <th className="text-right py-2 font-medium">Dist.</th>
                            <th className="py-2 font-medium w-12"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sold.comps.map((c, i) => (
                            <tr key={i} className="border-b border-surface-border/40">
                              <td className="py-1.5 text-ink max-w-[200px] truncate">{c.address}</td>
                              <td className="text-right font-mono text-bid">{fmt$(c.sale_price)}</td>
                              <td className="text-right text-ink-muted">{c.sq_footage ? `${Number(c.sq_footage).toLocaleString()} SF` : '—'}</td>
                              <td className="text-right text-ink-subtle">{c.distance_mi}mi</td>
                              <td className="py-1.5"><MapLinks address={c.address} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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
