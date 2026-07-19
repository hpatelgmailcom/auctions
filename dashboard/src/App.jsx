import { Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import clsx from 'clsx';
import {
  LayoutGrid, TableProperties, BarChart3, Bell, Building2,
  RefreshCw, Database, Mail, Archive
} from 'lucide-react';
import { api } from './api/client.js';

import ScreeningPage  from './pages/Screening.jsx';
import PipelinePage   from './pages/Pipeline.jsx';
import PropertyDetail from './pages/PropertyDetail.jsx';
import AnalyticsPage  from './pages/Analytics.jsx';
import AlertsPage     from './pages/Alerts.jsx';
import ArchivedPage   from './pages/Archived.jsx';

const NAV = [
  { to: '/',          label: 'Pipeline',  icon: LayoutGrid },
  { to: '/screening', label: 'Screening', icon: TableProperties },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/alerts',    label: 'Alerts',    icon: Bell },
  { to: '/archived',  label: 'Archived',  icon: Archive },
];

export default function App() {
  const [unseenAlerts, setUnseenAlerts] = useState(0);
  const [scraping,     setScraping]     = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.alerts.count().then(d => setUnseenAlerts(d.unseen)).catch(() => {});
    const t = setInterval(() => {
      api.alerts.count().then(d => setUnseenAlerts(d.unseen)).catch(() => {});
    }, 30000);
    return () => clearInterval(t);
  }, []);

  const [syncing,  setSyncing]  = useState(false);
  const [provider, setProvider] = useState('crexi');
  const [fetchingEmail, setFetchingEmail] = useState(false);
  const [emailStatus,   setEmailStatus]   = useState(null);

  useEffect(() => {
    api.email.status().then(setEmailStatus).catch(() => {});
  }, []);

  async function handleScrape() {
    setScraping(true);
    try {
      await api.scrape({ provider, max_price: 30000000, max_listings: 50, state: 'OH' });
    }
    finally { setTimeout(() => setScraping(false), 2000); }
  }

  async function handleEmailFetch() {
    setFetchingEmail(true);
    try { await api.email.fetch({}); }
    finally {
      // The fetch runs async server-side; refresh the status line shortly after.
      setTimeout(() => {
        setFetchingEmail(false);
        api.email.status().then(setEmailStatus).catch(() => {});
      }, 5000);
    }
  }

  async function handleSync() {
    setSyncing(true);
    try { await api.import(); }
    finally { setSyncing(false); }
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-surface-card border-r border-surface-border flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-surface-border">
          <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center shrink-0">
            <Building2 size={15} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink leading-tight">Hammerdown</p>
            <p className="text-[10px] text-ink-subtle">Auction Intelligence</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors',
                isActive
                  ? 'bg-brand/10 text-brand font-medium'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-hover'
              )}
            >
              <Icon size={16} />
              <span>{label}</span>
              {label === 'Alerts' && unseenAlerts > 0 && (
                <span className="ml-auto bg-brand text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                  {unseenAlerts > 99 ? '99+' : unseenAlerts}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Actions */}
        <div className="p-3 border-t border-surface-border space-y-2">
          <select
            value={provider}
            onChange={e => setProvider(e.target.value)}
            className="input text-xs py-1.5 w-full"
            aria-label="Scrape source"
          >
            <option value="crexi">Crexi (commercial)</option>
            <option value="auction_com">Auction.com (residential)</option>
            <option value="all">All providers</option>
          </select>
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="w-full flex items-center justify-center gap-2 btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <RefreshCw size={13} className={scraping ? 'animate-spin' : ''} />
            {scraping ? 'Running…' : 'Run Scraper'}
          </button>
          <button
            onClick={handleEmailFetch}
            disabled={fetchingEmail}
            className="w-full flex items-center justify-center gap-2 btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Mail size={13} className={fetchingEmail ? 'animate-pulse' : ''} />
            {fetchingEmail ? 'Fetching…' : 'Fetch Emails'}
          </button>
          {emailStatus?.totals?.parsed != null && (
            <p className="text-[10px] text-ink-subtle text-center leading-tight">
              {emailStatus.by_sender.length} sender{emailStatus.by_sender.length === 1 ? '' : 's'}
              {' · '}{emailStatus.totals.parsed} parsed
              {emailStatus.totals.error > 0 && <span className="text-red-400">{' · '}{emailStatus.totals.error} errors</span>}
              {emailStatus.unregistered.length > 0 && <span className="text-amber-400">{' · '}{emailStatus.unregistered.length} unmatched</span>}
            </p>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full flex items-center justify-center gap-2 btn-ghost text-xs disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Database size={12} className={syncing ? 'animate-pulse' : ''} />
            {syncing ? 'Syncing…' : 'Sync DB from Files'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-surface">
        <Routes>
          <Route path="/"             element={<PipelinePage />} />
          <Route path="/screening"    element={<ScreeningPage />} />
          <Route path="/analytics"    element={<AnalyticsPage />} />
          <Route path="/alerts"       element={<AlertsPage onSeenChange={setUnseenAlerts} />} />
          <Route path="/archived"     element={<ArchivedPage />} />
          <Route path="/listing/:id"  element={<PropertyDetail />} />
        </Routes>
      </main>
    </div>
  );
}
