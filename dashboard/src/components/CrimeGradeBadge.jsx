import clsx from 'clsx';

const gradeColor = (g) => {
  if (!g) return 'bg-surface-hover text-ink-muted';
  const first = g[0];
  if (first === 'A') return 'bg-emerald-900/50 text-emerald-400 border border-emerald-700/40';
  if (first === 'B') return 'bg-sky-900/50 text-sky-400 border border-sky-700/40';
  if (first === 'C') return 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/40';
  if (first === 'D') return 'bg-orange-900/50 text-orange-400 border border-orange-700/40';
  return 'bg-red-900/50 text-red-400 border border-red-700/40';
};

export default function CrimeGradeBadge({ grade }) {
  return (
    <span className={clsx('badge font-mono font-semibold', gradeColor(grade))}>
      {grade || '—'}
    </span>
  );
}
