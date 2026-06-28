/**
 * retry.js — exponential backoff with jitter for async operations.
 *
 * Usage:
 *   import { withRetry, retryFetch } from './retry.js';
 *
 *   // Wrap any async fn
 *   const data = await withRetry(() => fetch(url).then(r => r.json()));
 *
 *   // Drop-in fetch replacement with retry
 *   const res = await retryFetch(url, fetchOptions);
 */

// HTTP status codes that are worth retrying (transient server-side issues)
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

// Error message patterns that indicate transient network issues
const RETRYABLE_PATTERNS = [
  /ECONNRESET/i, /ECONNREFUSED/i, /ETIMEDOUT/i, /ENOTFOUND/i,
  /network/i, /timeout/i, /socket hang up/i, /fetch failed/i,
];

function isRetryable(err) {
  if (err?.status && !RETRYABLE_STATUSES.has(err.status)) return false;
  if (err?.status && RETRYABLE_STATUSES.has(err.status)) return true;
  return RETRYABLE_PATTERNS.some(re => re.test(err?.message || ''));
}

/** Small random jitter — spreads retries to avoid thundering herd */
const jitter = () => Math.floor(Math.random() * 200);

/**
 * Retry an async function with exponential backoff.
 *
 * @param {() => Promise<any>} fn          — async operation to retry
 * @param {object}             opts
 * @param {number}             opts.maxRetries   — max additional attempts after first failure (default 3)
 * @param {number}             opts.baseDelayMs  — initial wait in ms (default 500)
 * @param {number}             opts.maxDelayMs   — cap on wait time (default 8000)
 * @param {string}             opts.label        — shown in retry log lines (default 'request')
 * @param {(err) => boolean}   opts.shouldRetry  — override retryability check
 * @returns {Promise<any>}
 */
export async function withRetry(fn, {
  maxRetries  = 3,
  baseDelayMs = 500,
  maxDelayMs  = 8000,
  label       = 'request',
  shouldRetry = isRetryable,
} = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;

      const exhausted = attempt > maxRetries;
      const retryable = shouldRetry(err);

      if (exhausted || !retryable) {
        if (!retryable) {
          // Non-retryable errors (4xx etc.) — exit immediately, no noise
          throw err;
        }
        // Exhausted all retries
        err.retriesAttempted = maxRetries;
        throw err;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1) + jitter(), maxDelayMs);
      console.warn(
        `    [retry] ${label} failed (attempt ${attempt}/${maxRetries + 1}) — ${err.message?.split('\n')[0] || err}. Retrying in ${delay}ms…`
      );
      await sleep(delay);
    }
  }

  throw lastErr;
}

/**
 * Drop-in replacement for fetch() with retry.
 * Throws an enriched error for non-OK responses so retry logic can inspect status.
 */
export async function retryFetch(url, options = {}, retryOpts = {}) {
  return withRetry(async () => {
    const res = await fetch(url, options);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }, { label: new URL(url).hostname, ...retryOpts });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
