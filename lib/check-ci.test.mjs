// check-ci.mjs answers "are this commit's runs green" from the GitHub API, and
// the interesting parts are the ones that turn a response into that verdict:
// which flags are accepted, which cancelled run counts as replaced by a newer
// push, which failure is worth another poll, how long a rate limit asks us to
// stay away, and which exit code a report means. They are pure, so they are
// pinned here. That includes how a response's rate-limit headers become the
// error fields the wait reads, which needs a mocked fetch; the polling itself
// needs a live GitHub and was checked by hand against real runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exitCode, get, parseArgs, rateLimitWindow, retryable, startedLater } from '../scripts/check-ci.mjs';

test('parseArgs defaults to HEAD, no wait, and a 20 minute window', () => {
  assert.deepEqual(parseArgs([]), { ref: 'HEAD', wait: false, timeout: 1200, interval: 30, json: false });
});

test('parseArgs takes one revision and the report flags', () => {
  assert.equal(parseArgs(['main']).ref, 'main');
  assert.equal(parseArgs(['v2.38.31']).ref, 'v2.38.31');
  assert.equal(parseArgs(['--wait']).wait, true);
  assert.equal(parseArgs(['-w']).wait, true);
  assert.equal(parseArgs(['--json']).json, true);
  assert.deepEqual(parseArgs(['main', '--wait', '--json']), {
    ref: 'main',
    wait: true,
    timeout: 1200,
    interval: 30,
    json: true,
  });
});

test('parseArgs reads seconds with a space or an equals sign', () => {
  const spaced = parseArgs(['--timeout', '900', '--interval', '15']);
  assert.equal(spaced.timeout, 900);
  assert.equal(spaced.interval, 15);

  const joined = parseArgs(['--timeout=60', '--interval=5']);
  assert.equal(joined.timeout, 60);
  assert.equal(joined.interval, 5);

  assert.equal(parseArgs(['--timeout=1.5']).timeout, 1.5);
});

test('parseArgs refuses anything it cannot act on', () => {
  assert.throws(() => parseArgs(['--nope']), /unknown option --nope/);
  assert.throws(() => parseArgs(['main', 'other']), /only one revision can be checked, got "main" and "other"/);
});

test('parseArgs wants a positive number of seconds', () => {
  assert.throws(() => parseArgs(['--timeout', '0']), /--timeout wants a positive number of seconds, got "0"/);
  assert.throws(() => parseArgs(['--interval', '-5']), /--interval wants a positive number of seconds/);
  assert.throws(() => parseArgs(['--timeout', 'soon']), /--timeout wants a positive number of seconds/);
  // A flag as the last argument has no value at all.
  assert.throws(() => parseArgs(['--timeout']), /--timeout wants a positive number of seconds/);
});

/** A workflow run, with only the fields the superseded rule looks at. */
function run(overrides = {}) {
  return {
    id: 1,
    workflow_id: 7,
    created_at: '2026-11-20T20:00:00Z',
    status: 'completed',
    conclusion: 'cancelled',
    head_branch: 'main',
    ...overrides,
  };
}

test('startedLater matches a later run of the same workflow', () => {
  assert.equal(startedLater(run({ id: 2, created_at: '2026-11-20T20:01:00Z' }), run()), true);
  assert.equal(startedLater(run({ id: 2, created_at: '2026-11-20T19:59:00Z' }), run()), false);
});

test('startedLater ignores a run of another workflow or the run itself', () => {
  const later = { created_at: '2026-11-20T22:00:00Z' };
  assert.equal(startedLater(run({ id: 2, workflow_id: 8, ...later }), run()), false);
  assert.equal(startedLater(run({ id: 1, ...later }), run()), false);
});

test('startedLater falls back to the id when the times do not decide', () => {
  // Same timestamp: the newer id wins, so a push in the same second still
  // explains the cancellation.
  assert.equal(startedLater(run({ id: 5 }), run({ id: 4 })), true);
  assert.equal(startedLater(run({ id: 3 }), run({ id: 4 })), false);
  // No usable timestamps at all, which is what an older API payload looks like.
  assert.equal(startedLater(run({ id: 9, created_at: null }), run({ created_at: undefined })), true);
  // A later time always beats a higher id.
  assert.equal(startedLater(run({ id: 2, created_at: '2026-11-20T19:00:00Z' }), run({ id: 99 })), false);
});

test('retryable retries what another poll could fix', () => {
  assert.equal(retryable(new Error('fetch failed')), true, 'a network error has no status');
  assert.equal(retryable({ status: 429 }), true);
  assert.equal(retryable({ status: 500 }), true);
  assert.equal(retryable({ status: 502 }), true);
  assert.equal(retryable({ status: 403, rateLimited: true }), true, 'a secondary rate limit does clear');
});

test('retryable stops on an answer that will not change', () => {
  assert.equal(retryable({ status: 401 }), false, 'a bad token stays bad');
  assert.equal(retryable({ status: 404 }), false);
  assert.equal(retryable({ status: 422 }), false);
  assert.equal(retryable({ status: 403 }), false, 'a permission error is not a rate limit');
  assert.equal(retryable({ status: 400 }), false);
});

/**
 * Runs get() against one canned response, so the header reading can be checked
 * without GitHub. Returns the error it threw and the request it made; the real
 * fetch is always put back, even when an assertion below throws.
 */
async function getError(response, token = 'ghp_test') {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return response;
  };
  try {
    const error = await get('/repos/zakker111/freeway', token).then(
      () => assert.fail('a rejected response should throw'),
      (thrown) => thrown,
    );
    return { calls, error };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('get() reads retry-after into retryAfter for a secondary limit', async () => {
  const { calls, error } = await getError(
    new Response('{"message":"You have exceeded a secondary rate limit"}', {
      status: 403,
      headers: { 'retry-after': '4' },
    }),
  );

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/api\.github\.com\/repos\/zakker111\/freeway$/);
  assert.match(calls[0].init.headers.authorization, /^Basic /);

  assert.equal(error.status, 403);
  assert.equal(error.retryAfter, 4);
  assert.equal(error.resetAt, null, 'a secondary limit names no reset epoch');
  assert.equal(error.rateLimited, true);
  assert.equal(retryable(error), true);
  assert.equal(rateLimitWindow(error), 4000);
});

test('get() reads x-ratelimit-reset into resetAt for the hourly quota', async () => {
  const reset = Math.floor(Date.now() / 1000) + 90;
  const { error } = await getError(
    new Response('{"message":"API rate limit exceeded"}', {
      status: 429,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    }),
  );

  assert.equal(error.status, 429);
  assert.equal(error.retryAfter, null);
  assert.equal(error.resetAt, reset, 'the epoch is kept in seconds, as sent');
  assert.equal(error.rateLimited, true);
  assert.equal(retryable(error), true);
  // 90s before the reset, plus the one-second margin the sleep adds.
  assert.equal(rateLimitWindow(error, reset * 1000 - 90_000), 91_000);

  // A bare 429 still counts as a rate limit, it just names no window to sleep on.
  const bare = await getError(new Response('{"message":"slow down"}', { status: 429 }));
  assert.equal(bare.error.rateLimited, true);
  assert.equal(bare.error.retryAfter, null);
  assert.equal(bare.error.resetAt, null);
  assert.equal(retryable(bare.error), true);
  assert.equal(rateLimitWindow(bare.error), null);
});

test('get() leaves a plain 401 non-retryable', async () => {
  const { error } = await getError(new Response('{"message":"Bad credentials"}', { status: 401 }));

  assert.equal(error.status, 401);
  assert.match(error.message, /401/);
  assert.equal(error.retryAfter, null);
  assert.equal(error.resetAt, null);
  assert.equal(error.rateLimited, false, 'a bad token is not a rate limit');
  assert.equal(retryable(error), false);
  assert.equal(rateLimitWindow(error), null);
});

test('rateLimitWindow prefers retry-after over the reset header', () => {
  // A secondary limit sends both: retry-after is the short, specific answer, so
  // it wins even when the hourly reset is much further out (or already past).
  const now = Date.UTC(2026, 10, 20, 20, 0, 0);
  const both = { status: 403, rateLimited: true, retryAfter: 4, resetAt: now / 1000 + 900 };
  assert.equal(rateLimitWindow(both, now), 4000);
  assert.equal(rateLimitWindow({ ...both, resetAt: 1 }, now), 4000);
});

test('rateLimitWindow turns a reset timestamp into a positive wait', () => {
  const now = Date.UTC(2026, 10, 20, 20, 0, 0);
  // The epoch is in seconds, so a reset 30s away is a 31s wait: the extra second
  // keeps us from waking a hair before the window opens and being rejected again.
  assert.equal(rateLimitWindow({ rateLimited: true, resetAt: now / 1000 + 30 }, now), 31_000);
  // A reset in the past still means "allowed again", which is still a pause,
  // never a zero-length one that would spin the poll loop.
  assert.equal(rateLimitWindow({ rateLimited: true, resetAt: now / 1000 - 60 }, now), 1000);
  assert.equal(rateLimitWindow({ rateLimited: true, resetAt: now / 1000 }, now), 1000);
});

test('rateLimitWindow has no window without the headers', () => {
  // A bare 429 or a secondary limit with no headers keeps the plain retry path:
  // there is nothing to sleep for, so the interval decides.
  assert.equal(rateLimitWindow({ status: 429, rateLimited: true }), null);
  assert.equal(rateLimitWindow({ status: 403, rateLimited: true, retryAfter: null, resetAt: 0 }), null);
  // And an error that is not a rate limit at all is never slept on, headers or not.
  assert.equal(rateLimitWindow({ status: 500, retryAfter: 30, resetAt: Date.now() + 60_000 }), null);
  assert.equal(rateLimitWindow(undefined), null);
});

test('exitCode keeps green at 0 and every other verdict at 1', () => {
  assert.equal(exitCode({ ok: true, state: 'green' }), 0);
  assert.equal(exitCode({ ok: false, state: 'red' }), 1);
  assert.equal(exitCode({ ok: false, state: 'timeout', timedOut: true }), 1);
  assert.equal(exitCode({ ok: false, state: 'no-runs' }), 1);
  assert.equal(exitCode({ ok: false, state: 'unpushed' }), 1);
});

test('exitCode gives a check that could not run its own code', () => {
  assert.equal(exitCode({ ok: false, state: 'error', error: 'GitHub API replied 401' }), 2);
});
