const BASE = '/api';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

export const api = {
  listings: {
    list:   (params = {}) => req('/listings?' + new URLSearchParams(params)),
    get:    (id)           => req(`/listings/${id}`),
    events: (id)           => req(`/listings/${id}/events`),
    stage:  (id, stage)    => req(`/listings/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stage }) }),
    enrich: (id)           => req(`/listings/${id}/enrich`, { method: 'POST' }),
  },
  pipeline: {
    board: () => req('/pipeline'),
  },
  analytics: {
    funnel:   () => req('/analytics/funnel'),
    snapshot: () => req('/analytics/market-snapshot'),
    velocity: () => req('/analytics/pipeline-velocity'),
  },
  alerts: {
    list:    (unseen) => req(`/alerts${unseen ? '?unseen_only=true' : ''}`),
    count:   ()       => req('/alerts/count'),
    seen:    (id)     => req(`/alerts/${id}/seen`, { method: 'PATCH' }),
    seenAll: ()       => req('/alerts/seen-all', { method: 'PATCH' }),
  },
  scrape: (opts) => req('/scrape', { method: 'POST', body: JSON.stringify(opts) }),
};
