import { useState, useEffect } from 'react';
import clsx from 'clsx';

function msLeft(target) {
  const ms = new Date(target) - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return { d, h, m, ms };
}

function fmtLabel(left) {
  return left.d >= 1 ? `${left.d}d ${left.h}h` : `${left.h}h ${left.m}m`;
}

export default function AuctionCountdown({ date, endDate, compact = false }) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  if (!date) return <span className="text-ink-subtle text-xs">—</span>;

  const now = Date.now();
  const startMs = new Date(date).getTime();
  const endMs   = endDate ? new Date(endDate).getTime() : null;

  const isLive  = now >= startMs && (!endMs || now <= endMs);
  const isEnded = endMs ? now > endMs : now > startMs;

  if (isEnded) {
    return <span className="badge bg-surface-hover text-ink-subtle">Ended</span>;
  }

  if (isLive) {
    const left = endMs ? msLeft(endDate) : null;
    if (compact) {
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            <span className="text-xs font-bold text-emerald-400">LIVE</span>
          </div>
          {left && (
            <span className="text-[10px] text-ink-muted font-mono">ends {fmtLabel(left)}</span>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
          <span className="text-sm font-bold text-emerald-400">LIVE</span>
        </div>
        {left && (
          <div className="flex gap-2">
            {[['d', left.d], ['h', left.h], ['m', left.m]].map(([unit, val]) => (
              <div key={unit} className="flex flex-col items-center bg-emerald-500/10 rounded-lg px-2 py-1 min-w-[36px]">
                <span className="text-base font-mono font-bold text-emerald-400 leading-tight">
                  {String(val).padStart(2, '0')}
                </span>
                <span className="text-[9px] text-ink-subtle uppercase tracking-widest">{unit}</span>
              </div>
            ))}
          </div>
        )}
        {left && <span className="text-xs text-ink-subtle">until bidding closes</span>}
      </div>
    );
  }

  // Upcoming — countdown to start
  const left = msLeft(date);
  if (!left) return <span className="badge bg-surface-hover text-ink-subtle">Started</span>;

  const urgent  = left.d < 1;
  const warning = left.d < 3;

  if (compact) {
    return (
      <span className={clsx('text-xs font-mono font-medium',
        urgent ? 'text-nobid' : warning ? 'text-conditional' : 'text-ink-muted')}>
        {fmtLabel(left)}
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
