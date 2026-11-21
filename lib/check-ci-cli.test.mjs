// The machine contract of check-ci.mjs: with --json, stdout is one report
// object and the exit code says what kind of answer it is — 0 green, 1 a CI
// verdict, 2 nothing checked. That contract only exists once the script runs as
// a process, so each case here spawns the real script with a fetch mock that
// `--import` installs, and pins the whole report and the code together. The
// pure decisions are pinned in check-ci.test.mjs; this is the wire shape a push
// or release script reads, including the two answers a caller must not confuse
// with a green build: a workflow that never started, and a --wait that ran out
// of time. A rate limit on the commit lookup is here too, because believing it
// would turn a check of CI into exit 2.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(ROOT, 'test', 'check-ci-fetch.mjs');
const SCRIPT = join(ROOT, 'scripts', 'check-ci.mjs');
const REPO = 'zakker111/freeway';
const RUN = 'https://github.com/zakker111/freeway/actions/runs';

const env = { ...process.env };
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', env }).trim();

/**
 * An unreachable commit on top of HEAD with HEAD's tree: nothing points at it,
 * so `git branch --remotes --contains` cannot find it. Two tests need one — the
 * unpushed verdict, and the coverage rule, which compares a commit against its
 * parent (HEAD here) and so works in CI's depth-1 clone, where HEAD has none.
 */
const scratchCommit = (message) =>
  execFileSync('git', ['commit-tree', `${sha}^{tree}`, '-p', sha, '-m', message], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...env,
      GIT_AUTHOR_NAME: 'check-ci test',
      GIT_AUTHOR_EMAIL: 'check-ci@example.com',
      GIT_COMMITTER_NAME: 'check-ci test',
      GIT_COMMITTER_EMAIL: 'check-ci@example.com',
    },
  }).trim();

const neverPushed = scratchCommit('check-ci test: never pushed');
/** HEAD moved one commit forward, so its parent is HEAD and has no remote run. */
const child = scratchCommit('check-ci test: child of HEAD');

/**
 * Runs check-ci.mjs as a child for one scenario and returns its report, code
 * and stderr. GH_TOKEN is a fake so a request the mock missed cannot reach
 * GitHub, and the repository comes from the environment rather than a remote.
 */
function check(scenario, ref = sha, args = []) {
  const child = spawnSync(process.execPath, ['--import', MOCK, SCRIPT, ref, '--json', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...env,
      GH_TOKEN: 'ghp_test',
      GITHUB_REPOSITORY: REPO,
      MOCK_SCENARIO: scenario,
      MOCK_SHA: ref,
      MOCK_REPO: REPO,
    },
  });
  assert.equal(child.error, undefined);
  // stdout is the report and nothing else, whatever the verdict; the prose
  // goes to stderr so a caller can parse stdout unconditionally.
  return { status: child.status, report: JSON.parse(child.stdout), stderr: child.stderr };
}

test('green: exit 0 and a green report on stdout', () => {
  const { status, report, stderr } = check('green');

  assert.equal(status, 0);
  assert.deepEqual(report, {
    ok: true,
    state: 'green',
    repo: REPO,
    ref: sha,
    sha,
    waited: false,
    timedOut: false,
    counts: { total: 1, green: 1, superseded: 0, red: 0 },
    runs: [
      {
        id: 100,
        name: 'Tests',
        event: 'push',
        status: 'completed',
        conclusion: 'success',
        url: `${RUN}/100`,
        verdict: 'green',
      },
    ],
    missing: [],
  });
  assert.match(stderr, /OK all 1 run\(s\)/);
});

test('red: exit 1 with the failing run and its jobs', () => {
  const { status, report, stderr } = check('red');

  assert.equal(status, 1);
  assert.deepEqual(report, {
    ok: false,
    state: 'red',
    repo: REPO,
    ref: sha,
    sha,
    waited: false,
    timedOut: false,
    counts: { total: 1, green: 0, superseded: 0, red: 1 },
    runs: [
      {
        id: 101,
        name: 'Tests',
        event: 'push',
        status: 'completed',
        conclusion: 'failure',
        url: `${RUN}/101`,
        verdict: 'red',
        jobs: [
          {
            name: 'Linux',
            status: 'completed',
            conclusion: 'failure',
            url: `${RUN}/101/job/9`,
          },
        ],
      },
    ],
    missing: [],
  });
  assert.match(stderr, /FAIL 1 of 1 run\(s\)/);
});

test('superseded: exit 0 when a newer run replaced the cancellation', () => {
  const { status, report, stderr } = check('superseded');

  assert.equal(status, 0);
  assert.deepEqual(report, {
    ok: true,
    state: 'green',
    repo: REPO,
    ref: sha,
    sha,
    waited: false,
    timedOut: false,
    counts: { total: 1, green: 0, superseded: 1, red: 0 },
    runs: [
      {
        id: 102,
        name: 'Tests',
        event: 'push',
        status: 'completed',
        conclusion: 'cancelled',
        url: `${RUN}/102`,
        verdict: 'superseded',
        supersededBy: `${RUN}/103`,
      },
    ],
    missing: [],
  });
  assert.match(stderr, /superseded by a newer push/);
});

test('unpushed: exit 1 for a commit no remote branch contains', () => {
  const { status, report, stderr } = check('unpushed', neverPushed);

  assert.equal(status, 1);
  assert.deepEqual(report, {
    ok: false,
    state: 'unpushed',
    repo: REPO,
    ref: neverPushed,
    sha: neverPushed,
    waited: false,
    timedOut: false,
    counts: { total: 0, green: 0, superseded: 0, red: 0 },
    runs: [],
    missing: [],
  });
  assert.match(stderr, /is not on any remote branch/);
});

test('missing: exit 1 naming the workflow the previous commit ran', () => {
  // The commit under test is one past HEAD, so its parent — the commit the
  // mock answers a run for — is HEAD, which a depth-1 CI clone does have.
  const { status, report, stderr } = check('missing', child);

  assert.equal(status, 1);
  // The runs are green; the commit is red for the workflow that never started,
  // which is reported by name and path rather than as another failed run.
  assert.deepEqual(report, {
    ok: false,
    state: 'red',
    repo: REPO,
    ref: child,
    sha: child,
    waited: false,
    timedOut: false,
    counts: { total: 1, green: 0, superseded: 0, red: 0 },
    runs: [],
    missing: [{ name: 'Pages smoke', path: '.github/workflows/pages-smoke.yml' }],
  });
  assert.match(
    stderr,
    new RegExp(`FAIL 1 workflow\\(s\\) that ran for ${sha.slice(0, 7)} started no run for ${child}:`),
  );
  assert.match(stderr, /Pages smoke \(\.github\/workflows\/pages-smoke\.yml\)/);
});

test('timeout: exit 1 for a --wait whose run never finished', () => {
  const { status, report, stderr } = check('waiting', sha, ['--wait', '--timeout', '1', '--interval', '1']);

  assert.equal(status, 1);
  // A wait that runs out of time is a verdict about CI, not a broken check: the
  // unfinished run is still red, and timedOut says why it stayed that way.
  assert.deepEqual(report, {
    ok: false,
    state: 'red',
    repo: REPO,
    ref: sha,
    sha,
    waited: true,
    timedOut: true,
    counts: { total: 1, green: 0, superseded: 0, red: 1 },
    runs: [
      {
        id: 104,
        name: 'Tests',
        event: 'push',
        status: 'in_progress',
        conclusion: null,
        url: `${RUN}/104`,
        verdict: 'red',
        jobs: [
          {
            name: 'Linux',
            status: 'in_progress',
            conclusion: null,
            url: `${RUN}/104/job/9`,
          },
        ],
      },
    ],
    missing: [],
  });
  assert.match(stderr, /Still not finished after 1s/);
});

test('throttled reach: the commit lookup waits out the window instead of exit 2', () => {
  const { status, report, stderr } = check('throttled-reach', neverPushed);

  // The first lookup is rejected with retry-after 1; the answer after that is
  // 404, so the commit is reported as never pushed — a verdict, not the exit 2
  // a throttle used to produce.
  assert.equal(status, 1);
  assert.equal(report.state, 'unpushed');
  assert.equal(report.ref, neverPushed);
  assert.match(stderr, /rate limited: GitHub API replied 403/);
  assert.match(stderr, /sleeping 1s for the rate limit \(not the 30s interval\)/);
});

test('throttled reach: a window past --timeout is an error that names it', () => {
  const { status, report, stderr } = check('throttled-outlasts', neverPushed);

  assert.equal(status, 2);
  assert.equal(report.state, 'error');
  assert.match(
    report.error,
    /rate limited: GitHub asks to wait 25m, which outlasts the --timeout of 20m/,
  );
  assert.match(stderr, /try again later or raise --timeout/);
});

test('error: exit 2 with a report of nothing checked', () => {
  const { status, report, stderr } = check('error');

  assert.equal(status, 2);
  // The error report is deliberately minimal: a failed check has no verdict to
  // report, so a caller reads the code and this message rather than runs.
  assert.deepEqual(Object.keys(report).sort(), ['error', 'ok', 'state']);
  assert.equal(report.ok, false);
  assert.equal(report.state, 'error');
  assert.match(report.error, /GitHub API replied 401/);
  assert.match(stderr, /check-ci failed: GitHub API replied 401/);
});
