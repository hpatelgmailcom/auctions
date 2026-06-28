export default function Spinner({ size = 20 }) {
  return (
    <div className="flex items-center justify-center py-16">
      <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin text-brand" fill="none">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
        <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </div>
  );
}
