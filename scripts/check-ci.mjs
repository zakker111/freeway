#!/usr/bin/env node
// Reports the GitHub Actions runs for a commit and fails when any is not green.
//
// Pushing and then eyeballing the Actions tab is how a red run on main went
// unnoticed until the next push complained about the previous one. This asks
// the API instead and exits non-zero, so a push loop can stop on its own:
//
//   node scripts/check-ci.mjs            # HEAD
//   node scripts/check-ci.mjs main       # a branch, tag, short sha or HEAD
//   node scripts/check-ci.mjs main --wait
//
// The argument is any revision git understands: it is resolved through
// `git rev-parse <arg>^{commit}` before the API is asked. Passing a commit sha
// is the raw case, but a branch name like `main` is what one actually types
// after a push, and the API only matches full shas, so an unresolved `main`
// would silently report no runs.
//
// A run that is still queued or running counts as not green, and the report
// says so, so the answer is never "probably fine". `--wait` turns that
// failure into waiting: it polls the commit's runs every 30s and reports once
// they have all finished. Waiting for a run that is merely slow is the point,
// and the one-shot report stays the default because that is what a push loop
// wants. `--timeout` and `--interval` take seconds:
//
//   node scripts/check-ci.mjs main --wait --timeout 900 --interval 30
//
// The timeout exists so a stuck or never-started workflow still fails instead
// of hanging the shell forever.
//
// The token is read from GH_TOKEN, GITHUB_TOKEN or GITHUBFREEBUF, or from a
// `.env` file in this repository or the directory above it (where this
// workspace keeps GITHUBFREEBUF). It is sent with Basic auth: the token this
// repository deploys with authenticates the Actions API that way and answers
// 401 "Bad credentials" to a Bearer header.
//
// The runs API also ignores `head_sha` for some commits and answers
// total_count 0 while the commit really has runs, so a miss falls back to
// listing recent runs and filtering on head_sha locally.
//
// No dependencies; plain Node 20+.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://api.github.com';

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** Resolves a branch, tag, short sha or `HEAD` to the full commit sha. */
function resolveCommit(ref) {
  try {
    return git(['rev-parse', '--verify', `${ref}^{commit}`]);
  } catch {
    throw new Error(`cannot resolve ${JSON.stringify(ref)} to a commit in ${ROOT}`);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** `75` -> "1m15s", so timeouts read as dates rather than as raw seconds. */
function duration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}

/**
 * `--wait`, `--timeout <seconds>`, `--interval <seconds>` and one revision.
 * Seconds are used rather than minutes because a timeout is often set just
 * above the actual job time.
 */
function parseArgs(argv) {
  const options = { ref: 'HEAD', wait: false, timeout: 20 * 60, interval: 30 };
  let sawRef = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--wait' || arg === '-w') {
      options.wait = true;
      continue;
    }
    const flag = /^--(timeout|interval)(?:=(.*))?$/.exec(arg);
    if (flag) {
      const raw = flag[2] ?? argv[(i += 1)];
      const seconds = Number(raw);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw new Error(`--${flag[1]} wants a positive number of seconds, got ${JSON.stringify(raw)}`);
      }
      options[flag[1]] = seconds;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    if (sawRef) throw new Error(`only one revision can be checked, got ${JSON.stringify(options.ref)} and ${JSON.stringify(arg)}`);
    options.ref = arg;
    sawRef = true;
  }
  return options;
}

/** `KEY=value` lines from a dotenv file, ignoring comments and blank lines. */
function readEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return {};
  }
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadToken() {
  const fromEnvironment = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || process.env.GITHUBFREEBUF;
  if (fromEnvironment) return fromEnvironment.trim();
  for (const path of [join(ROOT, '.env'), resolve(ROOT, '..', '.env')]) {
    const values = readEnvFile(path);
    const token = values.GH_TOKEN || values.GITHUB_TOKEN || values.GITHUBFREEBUF;
    if (token) return token;
  }
  return '';
}

function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const url = git(['remote', 'get-url', 'origin']);
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  if (!match) throw new Error(`cannot read owner/repo from origin (${url})`);
  return match[1];
}

async function get(path, token) {
  const response = await fetch(`${API}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'freeway-check-ci',
      authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`GitHub API replied ${response.status} for ${path}${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
  return response.json();
}

async function findRuns(repo, sha, token) {
  let exact = null;
  try {
    exact = await get(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`, token);
  } catch (error) {
    console.error(`warning: ${error.message}`);
    console.error('warning: falling back to recent runs, filtered locally.');
  }
  if (exact?.total_count > 0) return exact.workflow_runs;

  const recent = await get(`/repos/${repo}/actions/runs?per_page=100`, token);
  return recent.workflow_runs.filter((run) => String(run.head_sha ?? '').startsWith(sha.slice(0, 7)));
}

/**
 * Polls a commit's runs until every one of them has finished, or until the
 * timeout expires. Returns whatever it last saw either way, plus whether it
 * gave up, so the caller reports the same way it reports a one-shot check.
 */
async function waitForRuns(repo, sha, token, options) {
  const deadline = Date.now() + options.timeout * 1000;
  let seen = [];
  let failures = 0;
  for (;;) {
    let runs = null;
    try {
      runs = await findRuns(repo, sha, token);
      failures = 0;
    } catch (error) {
      // One flaky poll should not throw away a wait that may be an hour long,
      // but repeating the same error forever is hiding a real problem.
      failures += 1;
      if (failures >= 5) throw error;
      console.error(`warning: ${error.message}`);
    }
    if (runs) seen = runs;

    const pending = seen.filter((run) => run.status !== 'completed');
    if (seen.length && !pending.length) return { runs: seen, timedOut: false };

    const left = Math.ceil((deadline - Date.now()) / 1000);
    if (left <= 0) return { runs: seen, timedOut: true };

    const pause = Math.min(options.interval, left);
    const state = seen.length
      ? `${seen.length - pending.length}/${seen.length} finished (${pending
          .map((run) => `${run.name} ${run.status}`)
          .join(', ')})`
      : 'no runs reported yet';
    console.log(`waiting: ${state} — checking again in ${duration(pause)}`);
    await sleep(pause * 1000);
  }
}

async function printJobs(repo, run, token) {
  let jobs;
  try {
    jobs = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, token);
  } catch (error) {
    console.log(`     (could not read the jobs: ${error.message})`);
    return;
  }
  for (const job of jobs.jobs ?? []) {
    const verdict = job.conclusion ?? job.status ?? 'unknown';
    console.log(`     job ${job.name}: ${verdict}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sha = resolveCommit(options.ref);
  const token = loadToken();
  if (!token) {
    throw new Error(
      'no GitHub token: set GH_TOKEN, GITHUB_TOKEN or GITHUBFREEBUF, ' +
        'or put one in .env here or one directory up',
    );
  }
  const repo = repository();
  const { runs, timedOut } = options.wait
    ? await waitForRuns(repo, sha, token, options)
    : { runs: await findRuns(repo, sha, token), timedOut: false };
  if (!runs.length) {
    const waited = timedOut ? ` after waiting ${duration(options.timeout)}` : '';
    console.log(`FAIL no Actions runs found for ${sha} in ${repo}${waited}.`);
    console.log('     A push that never triggered a workflow is not a green build.');
    process.exitCode = 1;
    return;
  }

  let red = 0;
  for (const run of runs) {
    const green = run.status === 'completed' && run.conclusion === 'success';
    console.log(
      `${green ? 'PASS' : 'FAIL'} ${run.name} (${run.event}) ${run.status}/${run.conclusion ?? '-'} ${run.html_url}`,
    );
    if (green) continue;
    red += 1;
    await printJobs(repo, run, token);
  }

  if (red) {
    console.log(`\nFAIL ${red} of ${runs.length} run(s) for ${sha} are not green.`);
    if (timedOut) {
      console.log(`     Still not finished after ${duration(options.timeout)}: try a longer --timeout.`);
    } else if (runs.some((run) => run.status !== 'completed')) {
      console.log('     Some runs are still in progress: re-run with --wait to wait for them.');
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\nOK all ${runs.length} run(s) for ${sha} are green.`);
}

try {
  await main();
} catch (cause) {
  console.error(`check-ci failed: ${cause.message}`);
  process.exitCode = 1;
}
