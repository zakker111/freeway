// A fetch mock for lib/check-ci-cli.test.mjs. That test runs check-ci.mjs as a
// child process, so `--import` installs this before the script's first request.
// It sits outside lib/ because test/cli.mjs requires every lib module to be
// inlined in the single-file build, and this is not part of the app.
// MOCK_SCENARIO picks what the API answers, and MOCK_SHA says which commit is
// under test. Another commit's head_sha (the parent the coverage rule asks
// about) answers with the parent's runs for the scenario that needs them, and
// empty for every other, so the coverage check stays out of the way.

const scenario = process.env.MOCK_SCENARIO ?? 'green';
const repo = process.env.MOCK_REPO ?? 'zakker111/freeway';
const sha = process.env.MOCK_SHA ?? '';

const json = (body, status = 200) => Response.json(body, { status });

/** A finished run, with the fields the report and the verdict rules read. */
function run(overrides = {}) {
  return {
    id: 100,
    workflow_id: 7,
    name: 'Tests',
    event: 'push',
    status: 'completed',
    conclusion: 'success',
    head_branch: 'main',
    head_sha: sha,
    path: '.github/workflows/test.yml',
    html_url: 'https://github.com/zakker111/freeway/actions/runs/100',
    created_at: '2026-11-20T20:00:00Z',
    ...overrides,
  };
}

const cancelled = run({
  id: 102,
  conclusion: 'cancelled',
  html_url: 'https://github.com/zakker111/freeway/actions/runs/102',
});
const replacing = run({
  id: 103,
  created_at: '2026-11-20T20:05:00Z',
  html_url: 'https://github.com/zakker111/freeway/actions/runs/103',
});

const runsFor = {
  green: [run()],
  red: [run({ id: 101, conclusion: 'failure', html_url: 'https://github.com/zakker111/freeway/actions/runs/101' })],
  superseded: [cancelled],
  // The cancellation is real, but the branch list that would explain it is
  // rejected, so nothing can say a newer run replaced it.
  'cancelled-throttled': [cancelled],
  unpushed: [],
  // Still going, so a --wait that runs out of time leaves it red.
  waiting: [
    run({
      id: 104,
      status: 'in_progress',
      conclusion: null,
      html_url: 'https://github.com/zakker111/freeway/actions/runs/104',
    }),
  ],
  missing: [run()],
  // The push under test is green on its own; the parent's extra run must not
  // be counted against it.
  'parent-dispatch': [run()],
  // Tests starts at once; Pages smoke only appears on the second poll.
  'late-workflow': [run()],
  // GitHub answers the head_sha query with nothing for this commit, though its
  // runs are in the recent list the fallback scans.
  fallback: [],
};

// A run of another commit, close enough in the list to be tempting and far
// enough in the sha that the prefix filter must drop it.
const decoy = run({
  id: 900,
  head_sha: 'dec0de0000000000000000000000000000000000',
  html_url: 'https://github.com/zakker111/freeway/actions/runs/900',
});

// A workflow that ran for the parent and starts a little after Tests on the
// next push: the push should start it too, just not yet.
const pagesSmoke = run({
  id: 110,
  name: 'Pages smoke',
  path: '.github/workflows/pages-smoke.yml',
  html_url: 'https://github.com/zakker111/freeway/actions/runs/110',
});

// What ran for the parent commit: a workflow that still has its file here, so
// this push should have started it too.
const parentRuns = {
  missing: [pagesSmoke],
  'late-workflow': [pagesSmoke],
  // Someone dispatched a release workflow by hand on the parent commit. A push
  // cannot start it, so the push is not measured against it.
  'parent-dispatch': [
    run({
      id: 111,
      name: 'Verify release',
      event: 'workflow_dispatch',
      path: '.github/workflows/verify-release.yml',
      html_url: 'https://github.com/zakker111/freeway/actions/runs/111',
    }),
  ],
};

// Every lookup of the commit endpoint is counted, so a throttle can answer the
// first one and the real answer only once the window it named has opened.
let commitLookups = 0;

// Likewise for the run list, so a workflow can start between two polls.
let runLookups = 0;

globalThis.fetch = async (url) => {
  const href = String(url);
  const path = href.slice('https://api.github.com'.length);

  // A bad token is the whole scenario: every request answers the same way.
  if (scenario === 'error') return json({ message: 'Bad credentials' }, 401);

  // The commit endpoint settles an empty run list: 404 means never pushed. The
  // throttled scenarios reject the first lookup with a window, because waiting
  // that window out instead of believing the rejection is what is under test.
  if (path.startsWith(`/repos/${repo}/commits/`)) {
    if (scenario === 'throttled-reach' || scenario === 'throttled-outlasts') {
      commitLookups += 1;
      if (commitLookups === 1) {
        return Response.json(
          { message: 'You have exceeded a secondary rate limit' },
          {
            status: 403,
            headers: {
              'retry-after': scenario === 'throttled-reach' ? '1' : '1500',
              'x-ratelimit-remaining': '0',
            },
          },
        );
      }
      return json({ message: 'Not Found' }, 404);
    }
    return scenario === 'unpushed' ? json({ message: 'Not Found' }, 404) : json({ sha });
  }

  if (path.endsWith('/jobs?per_page=100')) {
    const id = /runs\/(\d+)\/jobs/.exec(path)?.[1] ?? '101';
    const done = scenario !== 'waiting';
    return json({
      jobs: [
        {
          name: 'Linux',
          status: done ? 'completed' : 'in_progress',
          conclusion: done ? 'failure' : null,
          html_url: `https://github.com/zakker111/freeway/actions/runs/${id}/job/9`,
        },
      ],
    });
  }

  // The branch's runs, fetched only to explain a concurrency cancellation.
  // Throttling it is the one answer that must not be mistaken for a newer run:
  // the cancellation stays red and the reason it could not be explained is a
  // warning.
  if (path.includes('branch=')) {
    if (scenario === 'cancelled-throttled') {
      return Response.json(
        { message: 'You have exceeded a secondary rate limit' },
        { status: 403, headers: { 'retry-after': '1', 'x-ratelimit-remaining': '0' } },
      );
    }
    return json({ total_count: 2, workflow_runs: [replacing, cancelled] });
  }

  // The recent-runs fallback: the unfiltered list, from which the script keeps
  // only the runs whose head_sha starts with the commit it was asked about.
  const asked = new URL(href).searchParams.get('head_sha');
  if (!asked) {
    return scenario === 'fallback'
      ? json({ total_count: 2, workflow_runs: [decoy, run()] })
      : json({ total_count: 0, workflow_runs: [] });
  }
  // The second workflow starts only after the first has finished, which is the
  // window where a check watching just the runs it has seen calls the commit
  // green and then finds a workflow missing.
  if (asked === sha && scenario === 'late-workflow') {
    runLookups += 1;
    return json({
      total_count: 2,
      workflow_runs: runLookups === 1 ? [run()] : [run(), pagesSmoke],
    });
  }
  const wanted = asked === sha ? (runsFor[scenario] ?? []) : (parentRuns[scenario] ?? []);
  return json({ total_count: wanted.length, workflow_runs: wanted });
};
