import clsx from 'clsx';
import { Building2, Home } from 'lucide-react';

const TABS = [
  { value: '',            label: 'All',         icon: null },
  { value: 'commercial',  label: 'Commercial',  icon: Building2 },
  { value: 'residential', label: 'Residential', icon: Home },
];

/**
 * Segmented control to switch between commercial / residential views.
 * `counts` (optional) is a map like { commercial: 63, residential: 3 }.
 */
export default function AssetClassTabs({ value, onChange, counts }) {
  return (
    <div className="inline-flex rounded-lg border border-surface-border bg-surface-card p-0.5">
      {TABS.map(({ value: v, label, icon: Icon }) => {
        const active = value === v;
        const count  = v === '' ? undefined : counts?.[v];
        return (
          <button
            key={v || 'all'}
            onClick={() => onChange(v)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              active ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink',
            )}
          >
            {Icon && <Icon size={13} />}
            {label}
            {count != null && (
              <span className={clsx('font-mono', active ? 'text-white/80' : 'text-ink-subtle')}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
