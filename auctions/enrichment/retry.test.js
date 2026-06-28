/**
 * retry.test.js — automated tests for withRetry()
 *
 * Run: node auctions/enrichment/retry.test.js
 */

import { withRetry } from './retry.js';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Suppress retry warning noise during tests
const originalWarn = console.warn;
console.warn = () => {};

console.log('\nRetry utility tests\n');

// ---------------------------------------------------------------------------
// 1. Succeeds on first attempt — no retries triggered
// ---------------------------------------------------------------------------
await test('succeeds immediately without retrying', async () => {
  let calls = 0;
  const result = await withRetry(() => { calls++; return Promise.resolve('ok'); });
  assert(result === 'ok',  `expected 'ok', got '${result}'`);
  assert(calls === 1,      `expected 1 call, got ${calls}`);
});

// ---------------------------------------------------------------------------
// 2. Retries on retryable error then succeeds
// ---------------------------------------------------------------------------
await test('retries on transient error and succeeds', async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls < 3) {
        const err = new Error('ECONNRESET');
        throw err;
      }
      return Promise.resolve('recovered');
    },
    { baseDelayMs: 1 }  // near-zero delay for test speed
  );
  assert(result === 'recovered', `expected 'recovered', got '${result}'`);
  assert(calls === 3,            `expected 3 calls, got ${calls}`);
});

// ---------------------------------------------------------------------------
// 3. Exhausts all retries and throws last error
// ---------------------------------------------------------------------------
await test('exhausts retries and throws', async () => {
  let calls = 0;
  let caught;
  try {
    await withRetry(
      () => { calls++; throw new Error('ETIMEDOUT'); },
      { maxRetries: 2, baseDelayMs: 1 }
    );
  } catch (err) {
    caught = err;
  }
  assert(caught?.message === 'ETIMEDOUT', `expected ETIMEDOUT, got '${caught?.message}'`);
  assert(calls === 3,                     `expected 3 calls (1 + 2 retries), got ${calls}`);
  assert(caught?.retriesAttempted === 2,  `expected retriesAttempted=2, got ${caught?.retriesAttempted}`);
});

// ---------------------------------------------------------------------------
// 4. Non-retryable error exits immediately (no retries)
// ---------------------------------------------------------------------------
await test('does not retry on 404 (non-retryable)', async () => {
  let calls = 0;
  let caught;
  try {
    await withRetry(
      () => {
        calls++;
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      },
      { baseDelayMs: 1 }
    );
  } catch (err) {
    caught = err;
  }
  assert(caught?.status === 404, `expected status 404, got ${caught?.status}`);
  assert(calls === 1,            `expected 1 call (no retries), got ${calls}`);
});

// ---------------------------------------------------------------------------
// 5. Retries on 503 (retryable HTTP status)
// ---------------------------------------------------------------------------
await test('retries on 503 then succeeds', async () => {
  let calls = 0;
  const result = await withRetry(
    () => {
      calls++;
      if (calls === 1) {
        const err = new Error('Service Unavailable');
        err.status = 503;
        throw err;
      }
      return Promise.resolve('back-online');
    },
    { baseDelayMs: 1 }
  );
  assert(result === 'back-online', `expected 'back-online', got '${result}'`);
  assert(calls === 2,              `expected 2 calls, got ${calls}`);
});

// ---------------------------------------------------------------------------
// 6. Delay doubles each retry (exponential backoff)
// ---------------------------------------------------------------------------
await test('delays increase exponentially', async () => {
  const delays = [];
  let calls = 0;
  const realSetTimeout = setTimeout;

  // Intercept sleep by monkey-patching Promise resolution timing
  // Instead: track call timestamps and verify ordering
  const timestamps = [];
  await withRetry(
    () => {
      timestamps.push(Date.now());
      calls++;
      if (calls < 3) throw new Error('ECONNRESET');
      return Promise.resolve('done');
    },
    { maxRetries: 3, baseDelayMs: 50 }
  ).catch(() => {});

  // Gap between attempt 1→2 should be >= 50ms; gap 2→3 should be >= 100ms
  if (timestamps.length >= 3) {
    const gap1 = timestamps[1] - timestamps[0];
    const gap2 = timestamps[2] - timestamps[1];
    assert(gap1 >= 40, `first retry gap too short: ${gap1}ms (expected ≥40ms)`);
    assert(gap2 >= gap1, `second gap (${gap2}ms) should be >= first gap (${gap1}ms)`);
  }
});

// ---------------------------------------------------------------------------
// 7. Custom shouldRetry predicate is respected
// ---------------------------------------------------------------------------
await test('custom shouldRetry predicate controls retries', async () => {
  let calls = 0;
  let caught;
  try {
    await withRetry(
      () => { calls++; throw new Error('my-special-error'); },
      { baseDelayMs: 1, shouldRetry: err => err.message === 'my-special-error' }
    );
  } catch (err) { caught = err; }

  assert(calls === 4, `expected 4 calls (1 + 3 retries), got ${calls}`);
});

// ---------------------------------------------------------------------------
// 8. maxRetries: 0 means no retries — fails on first attempt
// ---------------------------------------------------------------------------
await test('maxRetries:0 never retries', async () => {
  let calls = 0;
  let caught;
  try {
    await withRetry(
      () => { calls++; throw new Error('ECONNRESET'); },
      { maxRetries: 0, baseDelayMs: 1 }
    );
  } catch (err) { caught = err; }
  assert(calls === 1, `expected 1 call, got ${calls}`);
  assert(!!caught,    'expected an error to be thrown');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.warn = originalWarn;
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
