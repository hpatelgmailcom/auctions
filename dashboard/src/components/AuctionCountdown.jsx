import { useState, useEffect } from 'react';
import clsx from 'clsx';

function diff(target) {
  const ms = new Date(target) - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000)  / 60000);
  return { d, h, m, ms };
}

export default function AuctionCountdown({ date, compact = false }) {
  const [left, setLeft] = useState(() => diff(date));

  useEffect(() => {
    const t = setInterval(() => setLeft(diff(date)), 60000);
    return () => clearInterval(t);
  }, [date]);

  if (!date) return <span className="text-ink-subtle text-xs">—</span>;
  if (!left) return <span className="badge bg-surface-hover text-ink-subtle">Ended</span>;

  const urgent = left.d < 1;
  const warning = left.d < 3;

  if (compact) {
    const label = left.d >= 1 ? `${left.d}d ${left.h}h` : `${left.h}h ${left.m}m`;
    return (
      <span className={clsx('text-xs font-mono font-medium',
        urgent ? 'text-nobid' : warning ? 'text-conditional' : 'text-ink-muted')}>
        {label}
      </span>
    );
  }

  return (
    <div className="flex gap-2">
      {[['d', left.d], ['h', left.h], ['m', left.m]].map(([unit, val]) => (
        <div key={unit} className={clsx(
          'flex flex-col items-center bg-surface-hover rounded-lg px-2 py-1 min-w-[36px]',
          urgent && 'bg-nobid-bg'
        )}>
          <span className={clsx('text-base font-mono font-bold leading-tight',
            urgent ? 'text-nobid' : warning ? 'text-conditional' : 'text-ink')}>
            {String(val).padStart(2, '0')}
          </span>
          <span className="text-[9px] text-ink-subtle uppercase tracking-widest">{unit}</span>
        </div>
      ))}
    </div>
  );
}
