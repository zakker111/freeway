// The machine contract of check-ci.mjs: with --json, stdout is one report
// object and the exit code says what kind of answer it is — 0 green, 1 a CI
// verdict, 2 nothing checked. That contract only exists once the script runs as
// a process, so each case here spawns the real script with a fetch mock that
// `--import` installs, and pins the whole report and the code together. The
// pure decisions are pinned in check-ci.test.mjs; this is the wire shape a push
// or release script reads.

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MOCK = join(ROOT, 'lib', 'check-ci-fetch.mjs');
const SCRIPT = join(ROOT, 'scripts', 'check-ci.mjs');
const REPO = 'zakker111/freeway';
const RUN = 'https://github.com/zakker111/freeway/actions/runs';

const env = { ...process.env };
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', env }).trim();

/**
 * A commit no remote has, so the unpushed verdict has something to name: the
 * check believes `git branch --remotes --contains`, which cannot contain a
 * commit nothing points at. It is unreachable, so git's own prune drops it.
 */
const neverPushed = execFileSync(
  'git',
  ['commit-tree', `${sha}^{tree}`, '-p', sha, '-m', 'check-ci test: never pushed'],
  {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...env,
      GIT_AUTHOR_NAME: 'check-ci test',
      GIT_AUTHOR_EMAIL: 'check-ci@example.com',
      GIT_COMMITTER_NAME: 'check-ci test',
      GIT_COMMITTER_EMAIL: 'check-ci@example.com',
    },
  },
).trim();

/**
 * Runs check-ci.mjs as a child for one scenario and returns its report, code
 * and stderr. GH_TOKEN is a fake so a request the mock missed cannot reach
 * GitHub, and the repository comes from the environment rather than a remote.
 */
function check(scenario, ref = sha) {
  const child = spawnSync(process.execPath, ['--import', MOCK, SCRIPT, ref, '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {
      ...env,
      GH_TOKEN: 'ghp_test',
      GITHUB_REPOSITORY: REPO,
      MOCK_SCENARIO: scenario,
      MOCK_SHA: sha,
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
