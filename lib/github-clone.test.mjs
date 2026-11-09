import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloneGithubRepo, resolveGithubCloneTarget } from './github-clone.mjs';

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-clone-'));
}

test('clone destinations stay directly inside the workspace', () => {
  const root = tempRoot();
  const plan = resolveGithubCloneTarget(root, 'zakker111/freeway', '');
  assert.equal(plan.repo, 'zakker111/freeway');
  assert.equal(plan.folder, 'freeway');
  assert.equal(plan.target, path.join(fs.realpathSync(root), 'freeway'));
  assert.equal(
    resolveGithubCloneTarget(root, 'zakker111/.github', '').folder,
    '.github',
    'a dot-prefixed repository name is still a safe folder',
  );

  for (const folder of ['..', '../outside', 'a/b', 'a\\b', '.git', '/absolute', 'C:\\tmp', 'trailing.']) {
    assert.throws(
      () => resolveGithubCloneTarget(root, 'zakker111/freeway', folder),
      /folder|slashes|workspace/i,
      folder,
    );
  }

  fs.mkdirSync(path.join(root, 'taken'));
  assert.throws(
    () => resolveGithubCloneTarget(root, 'zakker111/freeway', 'taken'),
    /already exists/,
  );
});

test('a clone uses a shallow URL and a process-only credential helper', async () => {
  const root = tempRoot();
  let seen;
  const run = async ({ args, cwd, env, timeoutMs }) => {
    seen = { args, cwd, env, timeoutMs };
    const target = args[args.length - 1];
    fs.mkdirSync(path.join(target, '.git'), { recursive: true });
    fs.writeFileSync(path.join(target, 'README.md'), 'hello');
    return { code: 0, output: 'Cloning into ...', truncated: false, timedOut: false };
  };

  const result = await cloneGithubRepo({
    root,
    token: 'ghp_test_secret',
    repo: 'zakker111/freeway',
    folder: 'freeway-copy',
    run,
  });

  assert.deepEqual(result, {
    repo: 'zakker111/freeway',
    folder: 'freeway-copy',
    path: 'freeway-copy',
    files: 1,
    shallow: true,
  });
  assert.equal(seen.cwd, fs.realpathSync(root));
  assert.equal(seen.timeoutMs, 180_000);
  assert.ok(seen.args.includes('--depth=1'));
  assert.ok(seen.args.includes('https://github.com/zakker111/freeway.git'));
  assert.equal(seen.env.FREEWAY_GITHUB_TOKEN, 'ghp_test_secret');
  assert.equal(seen.env.GITHUB_TOKEN, undefined);
  assert.equal(seen.env.GIT_TERMINAL_PROMPT, '0');
  const command = seen.args.join(' ');
  assert.ok(!command.includes('ghp_test_secret'), 'the token must never be an argument');
  assert.match(command, /FREEWAY_GITHUB_TOKEN/);
});

test('a failed clone removes its partial folder and redacts the token', async () => {
  const root = tempRoot();
  let target;
  const run = async ({ args }) => {
    target = args[args.length - 1];
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, 'partial.txt'), 'half a repository');
    return {
      code: 128,
      output: 'fatal: authentication failed for ghp_test_secret',
      truncated: false,
      timedOut: false,
    };
  };

  await assert.rejects(
    () =>
      cloneGithubRepo({
        root,
        token: 'ghp_test_secret',
        repo: 'zakker111/private-repo',
        run,
      }),
    (error) => {
      assert.equal(error.status, 502);
      assert.match(error.message, /could not clone/i);
      assert.match(error.message, /\[redacted\]/);
      assert.ok(!error.message.includes('ghp_test_secret'));
      return true;
    },
  );
  assert.equal(fs.existsSync(target), false);
});

test('a timed-out clone is stopped and cleaned up', async () => {
  const root = tempRoot();
  let target;
  const run = async ({ args }) => {
    target = args[args.length - 1];
    fs.mkdirSync(target);
    return { code: null, output: '', truncated: false, timedOut: true };
  };

  await assert.rejects(
    () => cloneGithubRepo({ root, token: 'ghp_test_secret', repo: 'zakker111/freeway', run }),
    /took too long/,
  );
  assert.equal(fs.existsSync(target), false);
});

test('cloning without a connected token never starts git', async () => {
  const root = tempRoot();
  let called = false;
  await assert.rejects(
    () =>
      cloneGithubRepo({
        root,
        token: '',
        repo: 'zakker111/freeway',
        run: async () => {
          called = true;
          return { code: 0, output: '' };
        },
      }),
    /Connect GitHub/,
  );
  assert.equal(called, false);
});
