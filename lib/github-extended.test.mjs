import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithub } from './github.mjs';

function fakeFetch(responses) {
  const calls = [];
  const fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const spec = responses.shift();
    if (!spec) throw new Error(`unexpected fetch ${url}`);
    const status = spec.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Headers(spec.headers ?? {}),
      json: async () => spec.body,
    };
  };
  return { fetch, calls };
}

test('reads repository details and branches', async () => {
  const fake = fakeFetch([
    {
      body: {
        full_name: 'zakker111/freeway',
        private: true,
        description: 'local chat app',
        default_branch: 'main',
        html_url: 'https://github.com/zakker111/freeway',
      },
    },
    {
      body: [
        { name: 'main', protected: true, commit: { sha: 'abc123' } },
        { name: 'feature', protected: false, commit: { sha: 'def456' } },
      ],
    },
  ]);
  const client = createGithub('ghp_test_token', { fetch: fake.fetch });
  const repo = await client.repo('zakker111/freeway');
  const branches = await client.branches('zakker111/freeway');
  assert.equal(repo.defaultBranch, 'main');
  assert.equal(repo.htmlUrl, 'https://github.com/zakker111/freeway');
  assert.deepEqual(branches, [
    { name: 'main', protected: true, sha: 'abc123' },
    { name: 'feature', protected: false, sha: 'def456' },
  ]);
  assert.match(fake.calls[0].url, /\/repos\/zakker111\/freeway$/);
  assert.match(fake.calls[1].url, /\/branches\?per_page=20/);
});

test('creates an issue, comments, then closes it', async () => {
  const fake = fakeFetch([
    {
      status: 201,
      body: { number: 7, title: 'Bug', state: 'open', html_url: 'https://github.com/zakker111/freeway/issues/7' },
    },
    { status: 201, body: { id: 99, html_url: 'https://github.com/zakker111/freeway/issues/7#issuecomment-99' } },
    { body: { number: 7, state: 'closed', labels: [], html_url: 'https://github.com/zakker111/freeway/issues/7' } },
  ]);
  const client = createGithub('ghp_test_token', { fetch: fake.fetch });
  const issue = await client.createIssue('zakker111/freeway', 'Bug', 'It breaks.');
  const comment = await client.comment('zakker111/freeway', 7, 'Looking.');
  const closed = await client.updateIssue('zakker111/freeway', 7, { state: 'closed', labels: ['bug'] });
  assert.equal(issue.number, 7);
  assert.equal(comment.id, 99);
  assert.equal(closed.state, 'closed');
  assert.equal(fake.calls[0].options.method, 'POST');
  assert.equal(JSON.parse(fake.calls[0].options.body).title, 'Bug');
  assert.match(fake.calls[1].url, /\/issues\/7\/comments$/);
  assert.equal(fake.calls[2].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(fake.calls[2].options.body), { state: 'closed', labels: ['bug'] });
});

test('opens, reviews and merges a pull request', async () => {
  const fake = fakeFetch([
    {
      status: 201,
      body: { number: 3, title: 'Add CI', state: 'open', html_url: 'https://github.com/zakker111/freeway/pull/3' },
    },
    { body: { id: 11, state: 'APPROVED', html_url: 'https://github.com/zakker111/freeway/pull/3#review-11' } },
    { body: { merged: true, sha: 'abc', message: 'Merged' } },
  ]);
  const client = createGithub('ghp_test_token', { fetch: fake.fetch });
  await client.createPull('zakker111/freeway', {
    title: 'Add CI',
    head: 'feature',
    base: 'main',
    body: 'Adds a workflow.',
    draft: true,
  });
  await client.reviewPull('zakker111/freeway', 3, { event: 'APPROVE' });
  const merged = await client.mergePull('zakker111/freeway', 3, { method: 'squash', deleteBranch: true });
  assert.equal(merged.merged, true);
  assert.deepEqual(JSON.parse(fake.calls[0].options.body), {
    title: 'Add CI',
    head: 'feature',
    base: 'main',
    body: 'Adds a workflow.',
    draft: true,
  });
  assert.deepEqual(JSON.parse(fake.calls[1].options.body), { event: 'APPROVE' });
  assert.deepEqual(JSON.parse(fake.calls[2].options.body), {
    merge_method: 'squash',
    delete_branch: true,
  });
});

test('dispatches, reruns and cancels Actions runs', async () => {
  const fake = fakeFetch([
    {
      body: {
        workflow_runs: [
          { id: 5, name: 'CI', run_number: 2, status: 'queued', conclusion: null, head_branch: 'main', html_url: 'https://github.com/zakker111/freeway/actions/runs/5' },
        ],
      },
    },
    { status: 204, body: null },
    { status: 204, body: null },
    { status: 204, body: null },
  ]);
  const client = createGithub('ghp_test_token', { fetch: fake.fetch });
  const runs = await client.workflowRuns('zakker111/freeway');
  assert.equal(runs[0].number, 2);
  assert.equal(runs[0].conclusion, null);
  const dispatched = await client.dispatchWorkflow('zakker111/freeway', {
    workflowId: 'ci.yml',
    ref: 'main',
    inputs: { target: 'web' },
  });
  const rerun = await client.rerunWorkflow('zakker111/freeway', 5);
  const cancel = await client.cancelWorkflow('zakker111/freeway', 5);
  assert.equal(dispatched.workflow, 'ci.yml');
  assert.equal(dispatched.ref, 'main');
  assert.equal(rerun.runId, 5);
  assert.equal(cancel.runId, 5);
  assert.match(fake.calls[1].url, /\/actions\/workflows\/ci\.yml\/dispatches$/);
  assert.deepEqual(JSON.parse(fake.calls[1].options.body), { ref: 'main', inputs: { target: 'web' } });
  assert.match(fake.calls[2].url, /\/actions\/runs\/5\/rerun$/);
  assert.match(fake.calls[3].url, /\/actions\/runs\/5\/cancel$/);
});

test('creates releases and repositories and searches', async () => {
  const fake = fakeFetch([
    { body: [{ tag_name: 'v1.0.0', name: 'First', draft: false, prerelease: false, html_url: 'https://github.com/zakker111/freeway/releases/v1.0.0' }] },
    { status: 201, body: { tag_name: 'v1.1.0', name: 'Second', html_url: 'https://github.com/zakker111/freeway/releases/v1.1.0' } },
    { status: 201, body: { full_name: 'zakker111/new-repo', private: true, default_branch: 'main', html_url: 'https://github.com/zakker111/new-repo' } },
    { body: { total_count: 1, items: [{ full_name: 'zakker111/freeway', description: 'local chat app', html_url: 'https://github.com/zakker111/freeway' }] } },
  ]);
  const client = createGithub('ghp_test_token', { fetch: fake.fetch });
  const releases = await client.releases('zakker111/freeway');
  const release = await client.createRelease('zakker111/freeway', {
    tag: 'v1.1.0',
    name: 'Second',
    body: 'Notes',
    draft: true,
    prerelease: false,
  });
  const repo = await client.createRepo({ name: 'new-repo', private: true, description: 'New' });
  const search = await client.search('freeway in:name', 'repos');
  assert.equal(releases[0].tag, 'v1.0.0');
  assert.equal(release.tag, 'v1.1.0');
  assert.equal(repo.fullName, 'zakker111/new-repo');
  assert.equal(search.total, 1);
  assert.deepEqual(JSON.parse(fake.calls[1].options.body), {
    tag_name: 'v1.1.0',
    name: 'Second',
    body: 'Notes',
    draft: true,
    prerelease: false,
  });
  assert.deepEqual(JSON.parse(fake.calls[2].options.body), {
    name: 'new-repo',
    private: true,
    description: 'New',
    auto_init: true,
  });
  assert.match(fake.calls[3].url, /search\/repositories\?q=/);
});

test('rejects incomplete or unsafe requests before fetching', async () => {
  const fake = fakeFetch([]);
  const client = createGithub('ghp_test_token', { fetch: fake.fetch });
  await assert.rejects(
    () => client.reviewPull('zakker111/freeway', 3, { event: 'REQUEST_CHANGES' }),
    /needs a body/i,
  );
  await assert.rejects(
    () => client.reviewPull('zakker111/freeway', 3, { event: 'SHIP_IT' }),
    /review event/i,
  );
  await assert.rejects(
    () => client.mergePull('zakker111/freeway', 3, { method: 'octopus' }),
    /merge method/i,
  );
  await assert.rejects(() => client.createRepo({ name: '..' }), /repository name/i);
  assert.equal(fake.calls.length, 0);
});
