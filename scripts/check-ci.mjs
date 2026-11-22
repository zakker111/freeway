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
// The timeout exists so a stuck workflow still fails instead of hanging the
// shell forever. A commit that never starts a workflow at all is not worth the
// full timeout, so an empty run list only gets a short grace period for the API
// to catch up; after that it fails as a commit with no runs.
//
// A 403 or 429 while waiting is usually a rate limit, and GitHub says how long
// to stay away: `retry-after` for a secondary limit, `x-ratelimit-reset` for
// the hourly quota. Polling at `--interval` before then only earns another
// rejection, and five of those in a row would end the wait as an error, so the
// wait sleeps for the window the API named instead. A window that reaches past
// the timeout cannot produce an answer, so the check stops there and says which
// window it needs (exit 2) rather than reporting a timeout against CI.
//
// The commit lookup an empty run list needs waits out a window the same way. A
// throttle there is not an answer, and treating it as one would report a
// perfectly good commit as "nothing could be checked": so the lookup sleeps
// for the window GitHub named and asks again, bounded by the same --timeout.
//
// A commit that was never pushed never grows a run either, and waiting the
// grace period for one only delays the actual fix. `git branch -r --contains`
// answers that from the remote-tracking refs already in the clone, and the
// commit endpoint settles the case of a clone that has not fetched lately, so
// an unpushed commit is reported as such straight away.
//
// A run cancelled by concurrency is not a failed commit: `cancel-in-progress`
// in test.yml and pages-smoke.yml stops it because a newer run of the same
// workflow started on the same branch. Pushing twice in a minute would
// otherwise leave the first commit red for no reason, so such a run is
// reported as SUPERSEDED along with the run that replaced it. A cancellation
// with no newer run behind it is still a failure.
//
// A push can also start fewer workflows than it should: a workflow whose `on:`
// block no longer matches the push simply does not run, and the runs that did
// start are still green. So a commit is also measured against the commit before
// it: whatever ran there and still has a workflow file here has to appear here
// too. A deleted workflow file is retired on purpose and is not expected, which
// is what makes removing one possible at all.
//
// A push or release script should not have to parse that prose. `--json`
// prints one object on stdout (progress and warnings move to stderr) and the
// exit code says what kind of answer this is: 0 green, 1 a verdict that is not
// green (red, timed out, no runs, never pushed, a workflow that never started),
// 2 nothing could be checked at
// all — bad arguments, a missing token, or an API failure such as 401. An empty
// run list whose push cannot be confirmed belongs to that second group too: "no
// workflow started" is only a verdict once the commit is known to be on the
// remote, so an unreadable lookup is not reported as a commit with no runs. An
// auth failure is answered once instead of being retried as a flaky poll.
// `runs` and `counts` always describe what the push did start, and `missing`
// names what it should have started and did not, so a caller that reads the
// counts is never told nothing ran when a green run did:
//
//   node scripts/check-ci.mjs main --wait --json
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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/**
 * Seconds --wait gives a commit to produce its first run. Pushing through the
 * API takes a moment to list the run, but a commit that triggers no workflow
 * never grows one, and waiting the full timeout for it teaches nothing.
 */
const FIRST_RUN_GRACE = 60;

/**
 * How long a finished run list holds off the green verdict for a workflow the
 * parent ran that has not appeared yet. Workflows start a few seconds apart, so
 * a check that only watches the runs it has seen can call a commit green and
 * then immediately call it red for a workflow that was still queueing.
 */
export const SETTLED_GRACE = 15;

/**
 * How many polls in a row --wait lets fail before it reports the check itself
 * as broken instead of a verdict about CI. One flaky poll should not throw away
 * a wait that may be an hour long; five in a row is no longer flaky.
 */
export const MAX_POLL_FAILURES = 5;

/** `75` -> "1m15s", so timeouts read as dates rather than as raw seconds. */
function duration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest ? `${minutes}m${rest}s` : `${minutes}m`;
}

/**
 * What a --wait loop does after one poll, decided from what that poll saw
 * rather than from any I/O, so every boundary is pinned in tests. `{ done }`
 * ends the wait: 'green' (every run finished), 'unpushed' (the commit is not on
 * the remote), 'error' (the poll failure budget is spent), 'timeout' (--timeout
 * is gone) or 'no-runs' (the first-run grace passed with nothing started).
 * Otherwise `{ pauseMs }` is how long to sleep before polling again.
 */
export function nextPoll({
  runs = [],
  failures = 0,
  reach = 'unknown',
  elapsedMs = 0,
  timeout,
  interval,
  pendingWorkflows = [],
  settledMs = 0,
}) {
  const pending = runs.filter((run) => run.status !== 'completed');
  const settled = runs.length > 0 && !pending.length;
  // Everything seen is finished, but a workflow the parent ran has not started.
  // Hold the green verdict for a short grace — unless the grace no longer fits
  // in what is left of --timeout, which is a window too short to wait in.
  const graceMs = SETTLED_GRACE * 1000 - settledMs;
  const leftMs = timeout * 1000 - elapsedMs;
  const lateWorkflow = settled && pendingWorkflows.length > 0 && graceMs > 0 && leftMs > 0;
  if (settled && !lateWorkflow) return { done: 'green' };

  // An empty run list is evidence only when the polls answered: while they are
  // failing, "never pushed" and "started nothing" are both unknown.
  if (!runs.length && !failures && reach === 'local-only') return { done: 'unpushed' };

  const left = Math.ceil((timeout * 1000 - elapsedMs) / 1000);

  // Checked before the clock because a poll that spends the budget throws its
  // own error, which says what failed; a timeout would hide that.
  if (failures >= MAX_POLL_FAILURES) return { done: 'error' };
  if (left <= 0) return { done: 'timeout' };

  // No run has appeared yet. That is normal for a few seconds after a push, but
  // a commit that starts nothing stays empty forever, so the grace period ends
  // the wait instead of the full timeout.
  const waited = Math.round(elapsedMs / 1000);
  if (!runs.length && !failures && waited >= FIRST_RUN_GRACE) return { done: 'no-runs' };

  let pause = Math.min(interval, left);
  // With no run yet, wake for the end of the grace rather than the next
  // interval: the answer "this commit starts nothing" is known by then.
  if (!runs.length && !failures) pause = Math.min(pause, Math.max(1, FIRST_RUN_GRACE - waited));
  // Same for a workflow that may still start: one more look when its grace ends.
  if (lateWorkflow) pause = Math.min(pause, Math.max(1, Math.ceil(graceMs / 1000)));
  return { pauseMs: pause * 1000 };
}

/**
 * `--wait`, `--timeout <seconds>`, `--interval <seconds>`, `--json` and one
 * revision. Seconds are used rather than minutes because a timeout is often
 * set just above the actual job time.
 */
export function parseArgs(argv) {
  const options = { ref: 'HEAD', wait: false, timeout: 20 * 60, interval: 30, json: false };
  let sawRef = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--wait' || arg === '-w') {
      options.wait = true;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
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
export function readEnvFile(path) {
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

/**
 * The token: the environment wins, then a `.env` in this repository, then one
 * in the directory above it. `env` and `paths` are arguments so the precedence
 * can be pinned without reading the real environment or touching a real file.
 */
export function loadToken({
  env = process.env,
  paths = [join(ROOT, '.env'), resolve(ROOT, '..', '.env')],
} = {}) {
  const fromEnvironment = env.GH_TOKEN || env.GITHUB_TOKEN || env.GITHUBFREEBUF;
  if (fromEnvironment) return fromEnvironment.trim();
  for (const path of paths) {
    const values = readEnvFile(path);
    const token = values.GH_TOKEN || values.GITHUB_TOKEN || values.GITHUBFREEBUF;
    if (token) return token;
  }
  return '';
}

/** `owner/repo` from a GitHub remote URL, or null when the URL is not one. */
export function repositoryFrom(url) {
  const match = /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/.exec(url);
  return match ? match[1] : null;
}

/**
 * The repository to ask about: GITHUB_REPOSITORY when CI sets it, else origin.
 * The remote URL is a parameter for the same reason as the token is.
 */
export function repository({ env = process.env, remoteUrl = () => git(['remote', 'get-url', 'origin']) } = {}) {
  if (env.GITHUB_REPOSITORY) return env.GITHUB_REPOSITORY;
  const url = remoteUrl();
  const found = repositoryFrom(url);
  if (!found) throw new Error(`cannot read owner/repo from origin (${url})`);
  return found;
}

export async function get(path, token) {
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
    const error = new Error(
      `GitHub API replied ${response.status} for ${path}${detail ? `: ${detail.slice(0, 120)}` : ''}`,
    );
    error.status = response.status;
    // A secondary rate limit arrives as a 403; its headers are the only way to
    // tell that apart from a permission error, which will never succeed.
    error.retryAfter = Number(response.headers.get('retry-after')) || null;
    // The hourly quota has no retry-after; it resets at this epoch instead.
    error.resetAt = Number(response.headers.get('x-ratelimit-reset')) || null;
    error.rateLimited =
      response.status === 429 ||
      Boolean(error.retryAfter) ||
      response.headers.get('x-ratelimit-remaining') === '0' ||
      /rate limit/i.test(detail);
    throw error;
  }
  return response.json();
}

/**
 * How long to stay away after a rate limit, in milliseconds, or null when the
 * error does not name a window. `retry-after` is what a secondary limit sends;
 * an exhausted hourly quota instead sends the epoch it resets at.
 */
export function rateLimitWindow(error, now = Date.now()) {
  if (!error?.rateLimited) return null;
  if (error.retryAfter) return error.retryAfter * 1000;
  if (error.resetAt) return Math.max(0, error.resetAt * 1000 - now) + 1000;
  return null;
}

/**
 * Whether another poll could plausibly answer differently. A bad token or a
 * wrong repository answers 401/404 every time, so retrying it like a flaky
 * network call only buries the real message under identical warnings.
 */
export function retryable(error) {
  const status = error?.status;
  if (!status) return true;
  if (status === 401 || status === 404 || status === 422) return false;
  if (status === 429 || status >= 500) return true;
  return Boolean(error.rateLimited);
}

/**
 * Sleeps out a rate limit GitHub named, for the poll loop and the commit lookup
 * alike, and returns true once the window is open. A window reaching past the
 * deadline is not worth sleeping: it can only end as "nothing could be checked",
 * so it is thrown straight away with the window it needs. Returns false when the
 * error names no window, leaving the caller's own retry rules in charge.
 */
async function waitOutRateLimit(error, { deadline, timeout, interval, say }) {
  const window = rateLimitWindow(error);
  if (window === null) return false;
  const leftMs = deadline - Date.now();
  if (window >= leftMs) {
    throw new Error(
      `rate limited: GitHub asks to wait ${duration(window / 1000)}, ` +
        `which outlasts the --timeout of ${duration(timeout)}` +
        (leftMs > 0 ? ` (${duration(leftMs / 1000)} left)` : '') +
        '; try again later or raise --timeout',
    );
  }
  say(`rate limited: ${error.message}`);
  say(
    `waiting: sleeping ${duration(window / 1000)} for the rate limit ` +
      `(not the ${duration(interval)} interval)`,
  );
  await sleep(window);
  return true;
}

/** stdout normally; stderr when stdout is reserved for the JSON report. */
function reporter(json) {
  return json ? (line = '') => console.error(line) : (line = '') => console.log(line);
}

/**
 * What a finished report exits with: 0 green, 1 a verdict that is not green
 * (red, timed out, no runs, never pushed), 2 nothing could be checked at all.
 * A `--json` caller reads the same answer from `state`, so the code and the
 * object come from one mapping instead of two that can drift.
 */
export function exitCode(report) {
  if (report?.ok) return 0;
  return report?.state === 'error' ? 2 : 1;
}

async function findRuns(repo, sha, token) {
  let exact = null;
  try {
    exact = await get(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=30`, token);
  } catch (error) {
    // A rate limit would reject the fallback query too, so let the caller wait
    // it out rather than spending a second request on it.
    if (error.rateLimited) throw error;
    console.error(`warning: ${error.message}`);
    console.error('warning: falling back to recent runs, filtered locally.');
  }
  if (exact?.total_count > 0) return exact.workflow_runs;

  const recent = await get(`/repos/${repo}/actions/runs?per_page=100`, token);
  return recent.workflow_runs.filter((run) => String(run.head_sha ?? '').startsWith(sha.slice(0, 7)));
}

/**
 * Whether a remote branch contains the commit according to the tracking refs
 * already in this clone. Free and instant, but only as fresh as the last
 * fetch, so a "no" is confirmed against the API before it is believed.
 */
function onRemoteBranch(sha) {
  try {
    return git(['branch', '--remotes', '--contains', sha]).length > 0;
  } catch {
    return false;
  }
}

const reachCache = new Map();

/**
 * Where a commit lives, so an empty run list can name the real problem:
 * 'remote' when the repository has it (pushed, no workflow started),
 * 'local-only' when it was never pushed, and 'unknown' when neither check can
 * say, which keeps the old waiting behaviour rather than guessing; a report
 * built on that 'unknown' fails as a check that could not run, not as no runs.
 * A throttle on the commit endpoint is not one of those answers: its window is
 * waited out through `pace`, the deadline the caller's timeout sets, so a rate
 * limit does not turn a waiting check into an exit-2 verdict.
 */
async function remoteReach(repo, sha, token, pace) {
  const key = `${repo}:${sha}`;
  if (!reachCache.has(key)) {
    let reach = 'unknown';
    if (onRemoteBranch(sha)) {
      reach = 'remote';
    } else {
      for (;;) {
        try {
          await get(`/repos/${repo}/commits/${sha}`, token);
          reach = 'remote';
          break;
        } catch (error) {
          if (error.status === 404 || error.status === 422) {
            reach = 'local-only';
            break;
          }
          if (await waitOutRateLimit(error, pace)) continue;
          console.error(`warning: could not tell whether ${sha} was pushed: ${error.message}`);
          break;
        }
      }
    }
    reachCache.set(key, reach);
  }
  return reachCache.get(key);
}

/** True when `candidate` is a later run of the same workflow than `run`. */
export function startedLater(candidate, run) {
  if (candidate.id === run.id || candidate.workflow_id !== run.workflow_id) return false;
  const later = Date.parse(candidate.created_at ?? '');
  const earlier = Date.parse(run.created_at ?? '');
  if (Number.isFinite(later) && Number.isFinite(earlier) && later !== earlier) return later > earlier;
  return candidate.id > run.id;
}

/**
 * The run that replaced a cancelled one, or null when nothing did. A branch's
 * run list covers every workflow, so one request answers for Tests and Pages
 * smoke alike, and it is only fetched when a cancellation needs explaining.
 */
async function replacingRun(repo, run, token, cache) {
  if (run.status !== 'completed' || run.conclusion !== 'cancelled') return null;
  const branch = run.head_branch;
  if (!branch) return null;
  if (!cache.has(branch)) {
    const list = await get(
      `/repos/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=100`,
      token,
    );
    cache.set(branch, list.workflow_runs ?? []);
  }
  return cache.get(branch).find((candidate) => startedLater(candidate, run)) ?? null;
}

/**
 * The workflows in `beforeRuns` that `runs` lacks, matched by the workflow file
 * a run names rather than by display name, and ignoring anything whose file is
 * not in `files` — the deletion that retires a workflow. Only a run of an event
 * this commit ran itself sets an expectation: someone dispatching a release
 * workflow by hand on the parent says nothing about a push, which cannot start
 * it, and a `schedule` run of it says nothing either.
 */
export function missingWorkflows(beforeRuns, runs, files) {
  const events = new Set(runs.map((run) => run.event).filter(Boolean));
  const expected = new Map();
  for (const run of beforeRuns) {
    if (!run.path || !run.event || !events.has(run.event)) continue;
    expected.set(run.path, run.name ?? run.path);
  }
  const present = new Set(runs.map((run) => run.path).filter(Boolean));
  const kept = new Set(files);
  return [...expected]
    .filter(([path]) => kept.has(path) && !present.has(path))
    .map(([path, name]) => ({ name, path }));
}

/**
 * Which workflows this commit should have started but did not: the ones that
 * ran for the commit before it on the same event, and whose file is still here.
 * A workflow that stops triggering keeps its file, so it shows up; one that was
 * deleted is retired on purpose and is not expected, and a run the parent only
 * got because someone dispatched it by hand cannot be expected of a push. Best
 * effort: when the parent or its runs cannot be read, the check says nothing
 * rather than failing a commit for a question it could not answer. A workflow
 * holding a `paths:` filter can skip a commit by design, so adding one means
 * revisiting this comparison.
 */
async function expectedWorkflows(repo, sha, runs, token) {
  let parent;
  try {
    parent = git(['rev-parse', '--verify', `${sha}^`]);
  } catch {
    return { parent: null, missing: [] }; // a root commit, or no parent in this clone
  }
  let before;
  try {
    before = await findRuns(repo, parent, token);
  } catch (error) {
    console.error(`warning: could not read the runs of ${parent.slice(0, 7)}: ${error.message}`);
    return { parent, missing: [] };
  }
  let files;
  try {
    files = git(['ls-tree', '--name-only', sha, '.github/workflows/']).split('\n').filter(Boolean);
  } catch {
    return { parent, missing: [] };
  }
  return { parent, missing: missingWorkflows(before, runs, files) };
}

/**
 * Polls a commit's runs until every one of them has finished, or until the
 * timeout expires. Returns whatever it last saw either way, plus whether it
 * gave up, so the caller reports the same way it reports a one-shot check.
 * What each poll decides is nextPoll()'s job; this supplies the clock, the
 * requests and the sleeping.
 */
async function waitForRuns(repo, sha, token, options, say) {
  const start = Date.now();
  const deadline = start + options.timeout * 1000;
  let seen = [];
  let failures = 0;
  let lastError = null;
  // When the runs currently seen all finished; null while one is going.
  let settledAt = null;
  for (;;) {
    let runs = null;
    try {
      runs = await findRuns(repo, sha, token);
      failures = 0;
    } catch (error) {
      // One flaky poll should not throw away a wait that may be an hour long,
      // but a 401 will answer the same way every time, so it is reported at
      // once; only errors another attempt could fix are retried at all.
      if (!retryable(error)) throw error;
      // GitHub named the window, so retrying at --interval before it opens only
      // earns another rejection and counts against the failure budget. Sleeping
      // is shared with the commit lookup below, which needs the same rule.
      if (await waitOutRateLimit(error, { ...options, deadline, say })) continue;
      lastError = error;
      failures += 1;
      // The failure budget belongs to nextPoll(), so the warning is only for
      // the polls that still have one left.
      if (failures < MAX_POLL_FAILURES) console.error(`warning: ${error.message}`);
    }
    if (runs) seen = runs;

    // A workflow the parent ran may start a few seconds after the others, so
    // the coverage check is consulted while waiting: its missing workflows are
    // what the grace in nextPoll() holds the green verdict for.
    const pending = seen.filter((run) => run.status !== 'completed');
    const settled = seen.length > 0 && !pending.length;
    if (settled) settledAt ??= Date.now();
    else settledAt = null;
    const coverage = settled
      ? await expectedWorkflows(repo, sha, seen, token)
      : { parent: null, missing: [] };

    // Nothing to wait for once the commit turns out never to have been pushed:
    // the run can never appear, and the fix is to push it. Asked only while the
    // run list is empty and the polls are answering, and cached, so the first
    // empty poll pays for it.
    const reach = !seen.length && !failures
      ? await remoteReach(repo, sha, token, { ...options, deadline, say })
      : 'unknown';
    const next = nextPoll({
      runs: seen,
      failures,
      reach,
      elapsedMs: Date.now() - start,
      timeout: options.timeout,
      interval: options.interval,
      pendingWorkflows: coverage.missing.map((workflow) => workflow.path),
      settledMs: settledAt === null ? 0 : Date.now() - settledAt,
    });
    if (next.done === 'error') throw lastError;
    if (next.done) {
      return {
        runs: seen,
        timedOut: next.done === 'timeout' || next.done === 'no-runs',
        gaveUp: next.done === 'green' ? null : next.done,
        // Reused by main so a green wait does not repeat the parent lookup.
        coverage: next.done === 'green' ? coverage : null,
      };
    }

    const state = seen.length
      ? pending.length
        ? `${seen.length - pending.length}/${seen.length} finished (${pending
            .map((run) => `${run.name} ${run.status}`)
            .join(', ')})`
        : `${seen.length} run(s) finished; ${coverage.missing
            .map((workflow) => workflow.name)
            .join(', ')} not started yet`
      : 'no runs reported yet';
    say(`waiting: ${state} — checking again in ${duration(next.pauseMs / 1000)}`);
    await sleep(next.pauseMs);
  }
}

/** A red run's jobs (and the reason they could not be read), for the report. */
async function readJobs(repo, run, token) {
  try {
    const body = await get(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`, token);
    return {
      jobs: (body.jobs ?? []).map((job) => ({
        name: job.name,
        status: job.status ?? null,
        conclusion: job.conclusion ?? null,
        url: job.html_url ?? null,
      })),
      error: null,
    };
  } catch (error) {
    return { jobs: [], error };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const say = reporter(options.json);
  const sha = resolveCommit(options.ref);
  const token = loadToken();
  if (!token) {
    throw new Error(
      'no GitHub token: set GH_TOKEN, GITHUB_TOKEN or GITHUBFREEBUF, ' +
        'or put one in .env here or one directory up',
    );
  }
  const repo = repository();
  // The commit lookup an empty run list needs may have to wait out a rate limit;
  // --timeout bounds that the same way it bounds --wait.
  const deadline = Date.now() + options.timeout * 1000;
  const { runs, timedOut, gaveUp, coverage } = options.wait
    ? await waitForRuns(repo, sha, token, options, say)
    : { runs: await findRuns(repo, sha, token), timedOut: false, gaveUp: null, coverage: null };

  // The same verdict as one object, for a push or release script. `state` is the
  // short answer, `runs` the detail behind it and `missing` the workflows the
  // push should have started but did not; the prose below is for people.
  const report = {
    ok: false,
    state: 'red',
    repo,
    ref: options.ref,
    sha,
    waited: Boolean(options.wait),
    timedOut: Boolean(timedOut),
    counts: { total: runs.length, green: 0, superseded: 0, red: 0 },
    runs: [],
    missing: [],
  };
  /** Prints the JSON report and gives the verdict its exit code: 0 green, 1 not. */
  const finish = () => {
    if (options.json) console.log(JSON.stringify(report, null, 2));
    process.exitCode = exitCode(report);
  };

  if (!runs.length) {
    const reach =
      gaveUp === 'unpushed' ? 'local-only' : await remoteReach(repo, sha, token, { ...options, deadline, say });
    if (reach === 'local-only') {
      report.state = 'unpushed';
      say(`FAIL ${sha} is not on any remote branch of ${repo}: push it before checking its runs.`);
      say('     A commit that was never pushed has no Actions runs to wait for.');
      finish();
      return;
    }
    // "No workflow started" is a verdict about CI only if the commit is on the
    // remote. When neither the remote-tracking refs nor the commit endpoint
    // could say, the empty list proves nothing, so this is a check that could
    // not run (exit 2) — reported like the rate limit that outlasts --timeout.
    // A wait that ran out of time still reports a timeout, because watching the
    // whole window is an answer about CI whatever kept the runs away.
    if (reach === 'unknown' && !timedOut) {
      throw new Error(
        `could not tell whether ${sha} was pushed to ${repo}, so an empty run list is no verdict: ` +
          'the remote-tracking refs and the commit endpoint both failed',
      );
    }
    report.state = timedOut ? 'timeout' : 'no-runs';
    const waited =
      gaveUp === 'no-runs'
        ? ` after waiting ${duration(FIRST_RUN_GRACE)} for a first run`
        : timedOut
          ? ` after waiting ${duration(options.timeout)}`
          : '';
    say(`FAIL no Actions runs found for ${sha} in ${repo}${waited}.`);
    say(
      reach === 'remote'
        ? '     The commit is on the remote, so it started no workflow at all.'
        : '     The wait saw no runs and could not confirm the commit was pushed.',
    );
    finish();
    return;
  }

  // A workflow that silently stopped triggering leaves the runs that did start
  // green, so the commit is also measured against the one before it. Held until
  // every run has finished: while one is still going the report already says
  // so, and a run that appears late would make the answer premature.
  const settled = runs.every((run) => run.status === 'completed');
  const { parent, missing } = settled
    ? (coverage ?? (await expectedWorkflows(repo, sha, runs, token)))
    : { parent: null, missing: [] };
  report.missing = missing;

  // The runs are described first and the coverage verdict only after them:
  // `runs` and `counts` say what the push actually started, which stays true
  // however the coverage check comes out. Reporting a missing workflow before
  // this loop left `counts` saying "1 total, 0 green" for a run that passed.
  const branchRuns = new Map();
  for (const run of runs) {
    const entry = {
      id: run.id,
      name: run.name,
      event: run.event,
      status: run.status ?? null,
      conclusion: run.conclusion ?? null,
      url: run.html_url,
      verdict: 'red',
    };
    const green = run.status === 'completed' && run.conclusion === 'success';
    if (green) {
      entry.verdict = 'green';
      report.counts.green += 1;
      report.runs.push(entry);
      say(`PASS ${run.name} (${run.event}) ${run.status}/${run.conclusion} ${run.html_url}`);
      continue;
    }
    let replaced = null;
    if (run.conclusion === 'cancelled') {
      try {
        replaced = await replacingRun(repo, run, token, branchRuns);
      } catch (error) {
        // Not knowing whether it was superseded is not proof that it was, so
        // the run stays red rather than becoming an excuse for a broken build.
        console.error(`warning: could not look for a newer ${run.name} run: ${error.message}`);
      }
    }
    if (replaced) {
      entry.verdict = 'superseded';
      entry.supersededBy = replaced.html_url;
      report.counts.superseded += 1;
      report.runs.push(entry);
      say(`SUPERSEDED ${run.name} (${run.event}) cancelled ${run.html_url}`);
      say(`     replaced by ${replaced.html_url}`);
      continue;
    }
    report.counts.red += 1;
    const { jobs, error } = await readJobs(repo, run, token);
    entry.jobs = jobs;
    if (error) entry.jobsError = error.message;
    report.runs.push(entry);
    say(`FAIL ${run.name} (${run.event}) ${run.status}/${run.conclusion ?? '-'} ${run.html_url}`);
    for (const job of jobs) say(`     job ${job.name}: ${job.conclusion ?? job.status ?? 'unknown'}`);
    if (error) say(`     (could not read the jobs: ${error.message})`);
  }

  if (missing.length) {
    report.state = 'red';
    say(`FAIL ${missing.length} workflow(s) that ran for ${parent.slice(0, 7)} started no run for ${sha}:`);
    for (const workflow of missing) say(`     ${workflow.name} (${workflow.path})`);
    say('     A workflow that silently stops triggering is not a green build.');
    finish();
    return;
  }

  if (report.counts.red) {
    const note = report.counts.superseded
      ? ` (${report.counts.superseded} superseded by a newer push)`
      : '';
    say(`\nFAIL ${report.counts.red} of ${runs.length} run(s) for ${sha} are not green${note}.`);
    if (timedOut) {
      say(`     Still not finished after ${duration(options.timeout)}: try a longer --timeout.`);
    } else if (runs.some((run) => run.status !== 'completed')) {
      say('     Some runs are still in progress: re-run with --wait to wait for them.');
    }
    finish();
    return;
  }
  report.ok = true;
  report.state = 'green';
  say(
    report.counts.superseded
      ? `\nOK ${runs.length - report.counts.superseded} of ${runs.length} run(s) for ${sha} are green, ` +
          `${report.counts.superseded} superseded by a newer push.`
      : `\nOK all ${runs.length} run(s) for ${sha} are green.`,
  );
  finish();
}

// lib/check-ci.test.mjs imports the helpers above, and importing them must not
// run the check against GitHub as a side effect.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    await main();
  } catch (cause) {
    const message = cause?.message || String(cause);
    // Exit 2 means nothing was checked: the verdict in exit 1 is about CI, this is
    // about the check itself (arguments, token, network), which a caller handles
    // differently from a red build.
    const report = { ok: false, state: 'error', error: message };
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    }
    console.error(`check-ci failed: ${message}`);
    process.exitCode = exitCode(report);
  }
}
