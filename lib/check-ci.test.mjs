// check-ci.mjs answers "are this commit's runs green" from the GitHub API, and
// the interesting parts are the ones that turn a response into that verdict:
// which flags are accepted, which cancelled run counts as replaced by a newer
// push, which failure is worth another poll, how long a rate limit asks us to
// stay away, what the wait does after each poll, which workflows a commit was
// expected to start, and which exit code a report means. They are pure, so they
// are pinned here. That includes how a response's rate-limit headers become the
// error fields the wait reads, which needs a mocked fetch; the sleeping and the
// requests themselves still need a live GitHub and were checked by hand against
// real runs.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  exitCode,
  get,
  loadToken,
  MAX_POLL_FAILURES,
  missingWorkflows,
  nextPoll,
  parseArgs,
  rateLimitWindow,
  readEnvFile,
  repository,
  repositoryFrom,
  retryable,
  SETTLED_GRACE,
  startedLater,
} from '../scripts/check-ci.mjs';

/** A dotenv file in a fresh temp directory, for the token lookup tests. */
function envFile(lines) {
  const path = join(mkdtempSync(join(tmpdir(), 'check-ci-env-')), '.env');
  writeFileSync(path, lines.join('\n'));
  return path;
}

test('readEnvFile takes KEY=value lines and strips one pair of quotes', () => {
  const path = envFile([
    '# a comment',
    '',
    'GH_TOKEN="double quoted"',
    "GITHUBFREEBUF='single quoted'",
    'GITHUB_TOKEN=bare',
    'URL=https://example.com/?a=b',
    'EMPTY=',
  ]);
  assert.deepEqual(readEnvFile(path), {
    GH_TOKEN: 'double quoted',
    GITHUBFREEBUF: 'single quoted',
    GITHUB_TOKEN: 'bare',
    URL: 'https://example.com/?a=b',
    EMPTY: '',
  });
  // A file that is not there is no token, not a crash.
  assert.deepEqual(readEnvFile(`${path}.absent`), {});
});

test('loadToken prefers the environment, then this .env, then the one above', () => {
  const here = envFile(['GITHUBFREEBUF=from-here']);
  const above = envFile(['GH_TOKEN=from-above']);
  const all = envFile(['GITHUBFREEBUF=app', 'GITHUB_TOKEN=action', 'GH_TOKEN=explicit']);

  // Environment variables in their own order, trimmed, ahead of any file.
  assert.equal(loadToken({ env: { GH_TOKEN: ' from-env ' }, paths: [here, above] }), 'from-env');
  assert.equal(loadToken({ env: { GITHUB_TOKEN: 'second' }, paths: [here, above] }), 'second');
  assert.equal(loadToken({ env: { GITHUBFREEBUF: 'third' }, paths: [here, above] }), 'third');
  // A whitespace-only variable is not a token: it must not shadow the next
  // one, or the file behind it, and end as "no token" on its own.
  assert.equal(loadToken({ env: { GH_TOKEN: '   ', GITHUB_TOKEN: 'second' }, paths: [] }), 'second');
  assert.equal(loadToken({ env: { GH_TOKEN: '  ', GITHUB_TOKEN: '' }, paths: [here] }), 'from-here');
  // Then the repository's file, then the one above it.
  assert.equal(loadToken({ env: {}, paths: [here, above] }), 'from-here');
  assert.equal(loadToken({ env: {}, paths: [above, here] }), 'from-above');
  // Within one file the same order holds.
  assert.equal(loadToken({ env: {}, paths: [all] }), 'explicit');
  assert.equal(loadToken({ env: {}, paths: [] }), '');
});

test('repositoryFrom reads the owner and repo from either remote form', () => {
  assert.equal(repositoryFrom('git@github.com:zakker111/freeway.git'), 'zakker111/freeway');
  assert.equal(repositoryFrom('git@github.com:zakker111/freeway'), 'zakker111/freeway');
  assert.equal(repositoryFrom('https://github.com/zakker111/freeway.git'), 'zakker111/freeway');
  assert.equal(repositoryFrom('https://github.com/zakker111/freeway'), 'zakker111/freeway');
  assert.equal(repositoryFrom('ssh://git@github.com/zakker111/freeway.git'), 'zakker111/freeway');
  // Another host is not a repository this script can check.
  assert.equal(repositoryFrom('git@gitlab.com:zakker111/freeway.git'), null);
  assert.equal(repositoryFrom(''), null);
});

test('repository prefers GITHUB_REPOSITORY and explains an origin it cannot read', () => {
  // CI sets the repository; the checkout may have no usable origin at all.
  assert.equal(
    repository({
      env: { GITHUB_REPOSITORY: 'zakker111/freeway' },
      remoteUrl: () => assert.fail('origin should not be read when CI names the repository'),
    }),
    'zakker111/freeway',
  );
  assert.equal(repository({ env: {}, remoteUrl: () => 'git@github.com:owner/repo.git' }), 'owner/repo');
  assert.throws(
    () => repository({ env: {}, remoteUrl: () => 'https://example.com/owner/repo' }),
    /cannot read owner\/repo from origin \(https:\/\/example\.com\/owner\/repo\)/,
  );
});

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

/** The inputs nextPoll decides from, at the defaults a --wait run starts with. */
function poll(overrides = {}) {
  return { runs: [], failures: 0, reach: 'unknown', elapsedMs: 0, timeout: 1200, interval: 30, ...overrides };
}

test('nextPoll is green only when every run has finished', () => {
  const done = [
    run({ status: 'completed', conclusion: 'success' }),
    run({ id: 2, status: 'completed', conclusion: 'failure' }),
  ];
  assert.deepEqual(nextPoll(poll({ runs: done, elapsedMs: 300_000 })), { done: 'green' });

  // One run still going keeps the wait alive, even with the rest green.
  const half = [done[0], run({ id: 3, status: 'in_progress', conclusion: null })];
  assert.deepEqual(nextPoll(poll({ runs: half })), { pauseMs: 30_000 });
});

test('nextPoll ends an unpushed commit at once, whatever the clock says', () => {
  // Pushing is the fix, so waiting for a run that can never appear only delays
  // it — even in the last second of the timeout.
  assert.deepEqual(nextPoll(poll({ reach: 'local-only' })), { done: 'unpushed' });
  assert.deepEqual(nextPoll(poll({ reach: 'local-only', elapsedMs: 1_199_000 })), { done: 'unpushed' });
  // A remote or unknown answer keeps waiting: only local-only is a verdict.
  assert.deepEqual(nextPoll(poll({ reach: 'remote' })), { pauseMs: 30_000 });
  assert.deepEqual(nextPoll(poll({ reach: 'unknown' })), { pauseMs: 30_000 });
  // While polls are failing the run list is empty because nothing was read, so
  // it cannot be held against the push.
  assert.deepEqual(nextPoll(poll({ reach: 'local-only', failures: 1 })), { pauseMs: 30_000 });
});

test('nextPoll holds the first-run grace, then calls it no runs', () => {
  // A push takes a moment to show up, so the first empty poll still waits the
  // interval, and later ones only for what is left of the grace period.
  assert.deepEqual(nextPoll(poll()), { pauseMs: 30_000 });
  assert.deepEqual(nextPoll(poll({ elapsedMs: 55_000 })), { pauseMs: 5000 });
  assert.deepEqual(nextPoll(poll({ elapsedMs: 59_400 })), { pauseMs: 1000 }, 'the last second of grace');
  // The waited time is rounded, so the grace ends half a second early rather
  // than polling once more for nothing.
  assert.deepEqual(nextPoll(poll({ elapsedMs: 59_500 })), { done: 'no-runs' });
  assert.deepEqual(nextPoll(poll({ elapsedMs: 60_000 })), { done: 'no-runs' });
});

test('nextPoll keeps the grace out of a failing or running wait', () => {
  // An empty list after the grace only means "no runs" when the polls were
  // answering; a failing poll just gets the interval.
  assert.deepEqual(nextPoll(poll({ elapsedMs: 90_000, failures: 1 })), { pauseMs: 30_000 });
  // A run that exists but has not finished is a different wait: the interval,
  // grace or not.
  const queued = [run({ status: 'queued', conclusion: null })];
  assert.deepEqual(nextPoll(poll({ elapsedMs: 90_000, runs: queued })), { pauseMs: 30_000 });
});

test('nextPoll stops when the timeout is gone', () => {
  const running = [run({ status: 'in_progress', conclusion: null })];
  // The interval never runs past the deadline: the last poll gets the seconds
  // that are left, and then the wait ends.
  assert.deepEqual(nextPoll(poll({ runs: running, elapsedMs: 1_199_000 })), { pauseMs: 1000 });
  assert.deepEqual(nextPoll(poll({ runs: running, elapsedMs: 1_200_000 })), { done: 'timeout' });
  assert.deepEqual(nextPoll(poll({ runs: running, elapsedMs: 1_200_500 })), { done: 'timeout' });
  // A timeout shorter than the grace still times out instead of reporting a
  // commit that started nothing.
  assert.deepEqual(nextPoll(poll({ timeout: 30, elapsedMs: 30_000 })), { done: 'timeout' });
  // No runs and one second left: one more poll, then the timeout.
  assert.deepEqual(nextPoll(poll({ timeout: 30, elapsedMs: 29_500 })), { pauseMs: 1000 });
});

test('nextPoll holds the green verdict for a workflow that may start late', () => {
  const done = [{ status: 'completed', path: TESTS.path, event: 'push' }];
  const late = [PAGES.path];
  // Nothing expected beyond what finished: green at once.
  assert.deepEqual(nextPoll(poll({ runs: done })), { done: 'green' });
  // A workflow the parent ran has not appeared yet: wait its grace out, waking
  // at the end of the grace rather than a full interval later.
  assert.deepEqual(nextPoll(poll({ runs: done, pendingWorkflows: late })), {
    pauseMs: SETTLED_GRACE * 1000,
  });
  assert.deepEqual(
    nextPoll(poll({ runs: done, pendingWorkflows: late, settledMs: 14_000 })),
    { pauseMs: 1000 },
  );
  // Spent: the coverage check gets to name what never started.
  assert.deepEqual(
    nextPoll(poll({ runs: done, pendingWorkflows: late, settledMs: SETTLED_GRACE * 1000 })),
    { done: 'green' },
  );
  // A --timeout with no room for the grace is not extended past it.
  assert.deepEqual(
    nextPoll(poll({ runs: done, pendingWorkflows: late, timeout: 5, elapsedMs: 5_000 })),
    { done: 'green' },
  );
  // A run still going is not settled, so the grace does not apply.
  assert.deepEqual(
    nextPoll(poll({ runs: [{ status: 'in_progress' }], pendingWorkflows: late })),
    { pauseMs: 30_000 },
  );
});

test('nextPoll spends five poll failures before it gives up', () => {
  assert.equal(MAX_POLL_FAILURES, 5, 'the warning text promises five');
  // Four failures is still a flaky API: warn, wait the interval, try again.
  assert.deepEqual(nextPoll(poll({ failures: 4, elapsedMs: 90_000 })), { pauseMs: 30_000 });
  assert.deepEqual(nextPoll(poll({ failures: 5 })), { done: 'error' });
  // The budget is checked before the clock, because the loop throws inside the
  // poll that spent it rather than returning a timeout after the fact.
  assert.deepEqual(nextPoll(poll({ failures: 5, elapsedMs: 1_200_000 })), { done: 'error' });
});

/** A workflow run as the coverage check sees it: its file and the event that started it. */
function workflowRun(path, name, event = 'push') {
  return { path, name, event };
}

const TESTS = workflowRun('.github/workflows/test.yml', 'Tests');
const PAGES = workflowRun('.github/workflows/pages-smoke.yml', 'Pages smoke');
const BOTH_FILES = [TESTS.path, PAGES.path];

test('missingWorkflows names a workflow that ran before but not now', () => {
  assert.deepEqual(missingWorkflows([TESTS, PAGES], [TESTS], BOTH_FILES), [
    { name: 'Pages smoke', path: PAGES.path },
  ]);
  assert.deepEqual(missingWorkflows([TESTS, PAGES], [TESTS, PAGES], BOTH_FILES), []);
});

test('missingWorkflows does not expect a workflow whose file is gone', () => {
  // Deleting the file is how a workflow is retired on purpose, so it is not a
  // push that forgot to start it.
  const old = workflowRun('.github/workflows/old.yml', 'Old');
  assert.deepEqual(missingWorkflows([TESTS, old], [TESTS], [TESTS.path]), []);
});

test('missingWorkflows ignores runs that are not workflow files', () => {
  // The Pages deployment run has a synthetic path and no file to match it.
  const deployment = workflowRun('dynamic/pages/pages-build-deployment', 'pages build and deployment');
  assert.deepEqual(missingWorkflows([deployment], [], [TESTS.path]), []);
  // A run with no path at all cannot be matched to a workflow either.
  assert.deepEqual(missingWorkflows([{ name: 'Tests' }], [], [TESTS.path]), []);
});

test('missingWorkflows matches on the file, not the workflow name', () => {
  // The same file under a new name did run: renaming a workflow is not a
  // missing workflow.
  const renamed = workflowRun(TESTS.path, 'Unit tests');
  assert.deepEqual(missingWorkflows([TESTS], [renamed], [TESTS.path]), []);
  // Renaming the file leaves the old path with nothing to expect.
  assert.deepEqual(missingWorkflows([TESTS], [], ['.github/workflows/testing.yml']), []);
});

test('missingWorkflows expects only workflows the same event can start', () => {
  const verify = workflowRun('.github/workflows/verify-release.yml', 'Verify release', 'workflow_dispatch');
  const files = [TESTS.path, PAGES.path, verify.path];
  // A manual run of a release workflow on the parent says nothing about a push,
  // which cannot start it; the workflow that did run on push is still expected.
  assert.deepEqual(missingWorkflows([verify, PAGES], [TESTS], files), [
    { name: 'Pages smoke', path: PAGES.path },
  ]);
  // A dispatch run of this commit is what makes a parent dispatch run expected,
  // so the comparison follows the events actually under test.
  assert.deepEqual(
    missingWorkflows([verify], [workflowRun(TESTS.path, 'Tests', 'workflow_dispatch')], files),
    [{ name: 'Verify release', path: verify.path }],
  );
  // A run with no event cannot be matched to anything, like one with no path.
  assert.deepEqual(missingWorkflows([{ path: verify.path, name: 'Verify release' }], [TESTS], files), []);
});

test('missingWorkflows expects nothing from a commit that started nothing', () => {
  // A first push, or a commit whose parent predates Actions, sets no bar.
  assert.deepEqual(missingWorkflows([], [TESTS], BOTH_FILES), []);
});
