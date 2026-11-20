#!/usr/bin/env node
// Reports the GitHub Actions runs for a commit and fails when any is not green.
//
// Pushing and then eyeballing the Actions tab is how a red run on main went
// unnoticed until the next push complained about the previous one. This asks
// the API instead and exits non-zero, so a push loop can stop on its own:
//
//   node scripts/check-ci.mjs            # HEAD
//   node scripts/check-ci.mjs main       # a branch, tag, short sha or HEAD
//
// The argument is any revision git understands: it is resolved through
// `git rev-parse <arg>^{commit}` before the API is asked. Passing a commit sha
// is the raw case, but a branch name like `main` is what one actually types
// after a push, and the API only matches full shas, so an unresolved `main`
// would silently report no runs.
//
// A run that is still queued or running counts as not green, and the report
// says so, so the answer is never "probably fine".
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
  const ref = process.argv.slice(2).find((arg) => !arg.startsWith('-')) || 'HEAD';
  const sha = resolveCommit(ref);
  const token = loadToken();
  if (!token) {
    throw new Error(
      'no GitHub token: set GH_TOKEN, GITHUB_TOKEN or GITHUBFREEBUF, ' +
        'or put one in .env here or one directory up',
    );
  }
  const repo = repository();
  const runs = await findRuns(repo, sha, token);
  if (!runs.length) {
    console.log(`FAIL no Actions runs found for ${sha} in ${repo}.`);
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
    const pending = runs.some((run) => run.status !== 'completed');
    if (pending) console.log('     Some runs are still in progress: re-run this check when they finish.');
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
