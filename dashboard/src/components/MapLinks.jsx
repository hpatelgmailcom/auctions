import { MapPin, Globe } from 'lucide-react';

export default function MapLinks({ address, stopPropagation = true }) {
  if (!address) return null;
  const q   = encodeURIComponent(address);
  const handleClick = stopPropagation ? e => e.stopPropagation() : undefined;

  return (
    <div className="flex items-center gap-0.5">
      <a href={`https://www.google.com/maps/search/?api=1&query=${q}`}
        target="_blank" rel="noreferrer"
        onClick={handleClick}
        title="Open in Google Maps"
        className="p-1 rounded text-ink-subtle hover:text-brand hover:bg-surface-hover transition-colors">
        <MapPin size={12} />
      </a>
      <a href={`https://earth.google.com/web/search/${q}`}
        target="_blank" rel="noreferrer"
        onClick={handleClick}
        title="Open in Google Earth"
        className="p-1 rounded text-ink-subtle hover:text-brand hover:bg-surface-hover transition-colors">
        <Globe size={12} />
      </a>
    </div>
  );
}
