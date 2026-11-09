import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithub, normalizeRepo } from './github.mjs';

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request: ${url}`);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      headers: new Map(Object.entries(next.headers ?? {})),
      json: async () => next.body ?? {},
    };
  };
  fn.calls = calls;
  return fn;
}

test('without a token nothing is requested', async () => {
  const client = createGithub('', { fetch: fakeFetch([]) });
  assert.equal(client.hasToken, false);
  await assert.rejects(() => client.repos(), /GitHub panel/);
});

test('lists repositories with only the fields the panel needs', async () => {
  const fetchImpl = fakeFetch([
    {
      status: 200,
      body: [
        {
          full_name: 'zakker111/freeway',
          private: true,
          description: 'local chat app',
          updated_at: '2026-11-03T10:00:00Z',
          default_branch: 'main',
          html_url: 'https://github.com/zakker111/freeway',
          owner: { login: 'zakker111' },
        },
      ],
    },
  ]);
  const client = createGithub('ghp_test', { fetch: fetchImpl });
  const repos = await client.repos();

  assert.deepEqual(repos, [
    {
      fullName: 'zakker111/freeway',
      private: true,
      description: 'local chat app',
      updatedAt: '2026-11-03T10:00:00Z',
      defaultBranch: 'main',
      htmlUrl: 'https://github.com/zakker111/freeway',
    },
  ]);

  const { url, init } = fetchImpl.calls[0];
  assert.match(url, /api\.github\.com\/user\/repos/);
  assert.equal(init.headers.authorization, 'Bearer ghp_test');
  assert.equal(init.headers.accept, 'application/vnd.github+json');
});

test('issues exclude pull requests', async () => {
  const client = createGithub('ghp_test', {
    fetch: fakeFetch([
      {
        status: 200,
        body: [
          { number: 7, title: 'a real issue', state: 'open', comments: 2, html_url: 'u1' },
          { number: 8, title: 'a pull request', state: 'open', pull_request: { url: 'x' } },
        ],
      },
    ]),
  });

  const issues = await client.issues('zakker111/freeway');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].number, 7);
  assert.equal(issues[0].comments, 2);
});

test('commits are flattened to one line each', async () => {
  const client = createGithub('ghp_test', {
    fetch: fakeFetch([
      {
        status: 200,
        body: [
          {
            sha: 'abcdef1234567890',
            commit: { message: 'Fix the thing\n\nLong explanation here', author: { name: 'Zak', date: '2026-11-03T09:00:00Z' } },
            author: { login: 'zakker111' },
          },
        ],
      },
    ]),
  });

  const commits = await client.commits('zakker111/freeway');
  assert.equal(commits[0].sha, 'abcdef1');
  assert.equal(commits[0].message, 'Fix the thing');
  assert.equal(commits[0].author, 'Zak');
});

test('a rejected token says so plainly', async () => {
  const client = createGithub('bad', { fetch: fakeFetch([{ status: 401, body: { message: 'Bad credentials' } }]) });
  await assert.rejects(() => client.viewer(), (error) => {
    assert.equal(error.status, 401);
    assert.match(error.message, /rejected the token/);
    return true;
  });
});

test('an exhausted rate limit reports when it resets', async () => {
  const reset = Math.floor(Date.now() / 1000) + 60;
  const client = createGithub('ghp_test', {
    fetch: fakeFetch([
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
        body: { message: 'API rate limit exceeded' },
      },
    ]),
  });

  await assert.rejects(() => client.repos(), (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /rate limit is exhausted/);
    return true;
  });
});

test('a missing repository is a 404 with a useful message', async () => {
  const client = createGithub('ghp_test', { fetch: fakeFetch([{ status: 404, body: { message: 'Not Found' } }]) });
  await assert.rejects(() => client.commits('zakker111/nope'), /cannot see it/);
});

test('creating an issue posts a trimmed payload', async () => {
  const fetchImpl = fakeFetch([
    { status: 201, body: { number: 12, title: 'Reported by the model', html_url: 'https://github.com/x/y/issues/12' } },
  ]);
  const client = createGithub('ghp_test', { fetch: fetchImpl });
  const issue = await client.createIssue('zakker111/freeway', '  Reported by the model  ', 'body text');

  assert.equal(issue.number, 12);
  const { url, init } = fetchImpl.calls[0];
  assert.equal(init.method, 'POST');
  assert.match(url, /\/repos\/zakker111\/freeway\/issues$/);
  const sent = JSON.parse(init.body);
  assert.equal(sent.title, 'Reported by the model');
  assert.equal(sent.body, 'body text');
});

test('an issue without a title never reaches the network', async () => {
  const fetchImpl = fakeFetch([]);
  const client = createGithub('ghp_test', { fetch: fetchImpl });
  await assert.rejects(() => client.createIssue('zakker111/freeway', '   '), /needs a title/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('repository names are validated', () => {
  assert.equal(normalizeRepo(' zakker111/freeway '), 'zakker111/freeway');
  assert.throws(() => normalizeRepo('freeway'), /owner\/name/);
  assert.throws(() => normalizeRepo('a/b/c'), /owner\/name/);
  assert.throws(() => normalizeRepo(''), /owner\/name/);
});
