import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pullGithubRepo, pushGithubRepo, switchGithubBranch } from './github-clone.mjs';

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-github-sync-'));
  fs.mkdirSync(path.join(root, 'repo', '.git'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, folder: 'repo', target: path.join(root, 'repo') };
}

const REMOTE = 'https://github.com/zakker111/freeway.git\n';

test('pull is fast-forward only and keeps the token out of argv', async (t) => {
  const place = workspace(t);
  const calls = [];
  const run = async (call) => {
    calls.push(call);
    if (call.args[0] === 'remote') return { code: 0, output: REMOTE };
    return { code: 0, output: 'Already up to date.\n' };
  };
  const result = await pullGithubRepo({
    ...place,
    token: 'ghp_test_secret',
    repo: 'zakker111/freeway',
    run,
  });
  assert.equal(result.repo, 'zakker111/freeway');
  assert.equal(result.folder, 'repo');
  assert.match(result.output, /Already up to date/);
  assert.deepEqual(calls[1].args.slice(-2), ['pull', '--ff-only']);
  assert.equal(calls[1].env.FREEWAY_GITHUB_TOKEN, 'ghp_test_secret');
  assert.equal(calls.flatMap((call) => call.args).join(' ').includes('ghp_test_secret'), false);
});

test('push sends only the current branch and never force', async (t) => {
  const place = workspace(t);
  const calls = [];
  const run = async (call) => {
    calls.push(call);
    if (call.args[0] === 'remote') return { code: 0, output: REMOTE };
    if (call.args[0] === 'rev-parse') return { code: 0, output: 'feature\n' };
    return { code: 0, output: 'To github.com:zakker111/freeway.git\n' };
  };
  const result = await pushGithubRepo({
    ...place,
    token: 'ghp_test_secret',
    repo: 'zakker111/freeway',
    run,
  });
  assert.equal(result.branch, 'feature');
  assert.equal(result.repo, 'zakker111/freeway');
  assert.ok(calls[2].args.includes('--porcelain'));
  assert.equal(calls[2].args.at(-1), 'HEAD:refs/heads/feature');
  assert.equal(calls[2].args.includes('--force'), false);
  assert.equal(calls.flatMap((call) => call.args).join(' ').includes('ghp_test_secret'), false);
});

test('sync refuses a different repository and a non-HTTPS origin', async (t) => {
  const place = workspace(t);
  const run = async () => ({ code: 0, output: REMOTE });
  await assert.rejects(
    () => pullGithubRepo({ ...place, token: 'ghp_test_secret', repo: 'other/repo', run }),
    /belongs to zakker111\/freeway/,
  );
  const sshRun = async () => ({ code: 0, output: 'git@github.com:zakker111/freeway.git\n' });
  await assert.rejects(
    () => pullGithubRepo({ ...place, token: 'ghp_test_secret', run: sshRun }),
    /plain HTTPS/,
  );
});

test('branch switching stays local and validates the name', async (t) => {
  const place = workspace(t);
  const calls = [];
  const run = async (call) => {
    calls.push(call);
    return { code: 0, output: 'Switched to a new branch.\n' };
  };
  const created = await switchGithubBranch({ ...place, name: 'feature', run });
  assert.equal(created.branch, 'feature');
  assert.equal(created.created, true);
  assert.deepEqual(calls[0].args, ['switch', '-c', 'feature']);
  assert.equal(calls[0].env.FREEWAY_GITHUB_TOKEN || '', '');

  calls.length = 0;
  await switchGithubBranch({ ...place, name: 'main', create: false, run });
  assert.deepEqual(calls[0].args, ['switch', 'main']);

  calls.length = 0;
  await assert.rejects(
    () => switchGithubBranch({ ...place, name: '-bad', run }),
    /valid branch name/,
  );
  assert.equal(calls.length, 0);
});

test('a failed git command is reported without the token', async (t) => {
  const place = workspace(t);
  const run = async (call) => {
    if (call.args[0] === 'remote') return { code: 0, output: REMOTE };
    return { code: 1, output: `fatal: could not read from ${call.env.FREEWAY_GITHUB_TOKEN}\n` };
  };
  await assert.rejects(
    () => pullGithubRepo({ ...place, token: 'ghp_test_secret', run }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.message.includes('ghp_test_secret'), false);
      assert.match(error.message, /\[redacted\]/);
      return true;
    },
  );
});
