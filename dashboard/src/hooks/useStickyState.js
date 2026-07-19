import { useState, useEffect } from 'react';

/**
 * useState persisted to localStorage — filter selections survive navigation
 * and page reloads. Plain-object defaults are merged over the saved value so
 * filter keys added in later versions pick up their defaults instead of
 * being undefined.
 */
export function useStickyState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved != null) {
        const parsed = JSON.parse(saved);
        const mergeable = typeof defaultValue === 'object' && defaultValue !== null && !Array.isArray(defaultValue);
        return mergeable ? { ...defaultValue, ...parsed } : parsed;
      }
    } catch { /* corrupted entry — fall back to the default */ }
    return defaultValue;
  });

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full/blocked */ }
  }, [key, value]);

  return [value, setValue];
}
