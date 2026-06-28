import { Inbox } from 'lucide-react';

export default function EmptyState({ message = 'No data found' }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-ink-subtle">
      <Inbox size={36} strokeWidth={1.2} />
      <p className="text-sm">{message}</p>
    </div>
  );
}
