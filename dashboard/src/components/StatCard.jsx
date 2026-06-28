import clsx from 'clsx';

export default function StatCard({ label, value, sub, accent, icon: Icon }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-ink-subtle font-medium uppercase tracking-wider">{label}</span>
        {Icon && <Icon size={14} className="text-ink-subtle" />}
      </div>
      <span className={clsx('text-2xl font-bold tracking-tight', accent || 'text-ink')}>{value ?? '—'}</span>
      {sub && <span className="text-xs text-ink-subtle">{sub}</span>}
    </div>
  );
}
