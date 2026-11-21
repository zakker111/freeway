// A fetch mock for lib/check-ci-cli.test.mjs. That test runs check-ci.mjs as a
// child process, so `--import` installs this before the script's first request.
// It sits outside lib/ because test/cli.mjs requires every lib module to be
// inlined in the single-file build, and this is not part of the app.
// MOCK_SCENARIO picks what the API answers, and MOCK_SHA says which commit is
// under test — every other head_sha (the parent commit) answers empty, so the
// coverage check stays out of the way.

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
  unpushed: [],
};

globalThis.fetch = async (url) => {
  const href = String(url);
  const path = href.slice('https://api.github.com'.length);

  // A bad token is the whole scenario: every request answers the same way.
  if (scenario === 'error') return json({ message: 'Bad credentials' }, 401);

  // The commit endpoint settles an empty run list: 404 means never pushed.
  if (path.startsWith(`/repos/${repo}/commits/`)) {
    return scenario === 'unpushed' ? json({ message: 'Not Found' }, 404) : json({ sha });
  }

  if (path.endsWith('/jobs?per_page=100')) {
    return json({
      jobs: [
        {
          name: 'Linux',
          status: 'completed',
          conclusion: 'failure',
          html_url: 'https://github.com/zakker111/freeway/actions/runs/101/job/9',
        },
      ],
    });
  }

  // The branch's runs, fetched only to explain a concurrency cancellation.
  if (path.includes('branch=')) {
    return json({ total_count: 2, workflow_runs: [replacing, cancelled] });
  }

  const asked = new URL(href).searchParams.get('head_sha');
  // The recent-runs fallback, and the parent commit's runs.
  if (!asked || asked !== sha) return json({ total_count: 0, workflow_runs: [] });
  const runs = runsFor[scenario] ?? [];
  return json({ total_count: runs.length, workflow_runs: runs });
};
