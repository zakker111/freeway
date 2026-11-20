// check-ci.mjs answers "are this commit's runs green" from the GitHub API, and
// the interesting parts are the ones that turn a response into that verdict:
// which flags are accepted, which cancelled run counts as replaced by a newer
// push, which failure is worth another poll, and which exit code a report means.
// They are pure, so they are pinned here; the polling itself needs a live
// GitHub and was checked by hand against real runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exitCode, parseArgs, retryable, startedLater } from '../scripts/check-ci.mjs';

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
