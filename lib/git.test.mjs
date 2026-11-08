import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitStatus, gitDiff, gitCommit, gitRevert, normalizeGitPaths } from './git.mjs';
import { runTool } from './tools.mjs';

function command(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  command(root, ['init', '-q']);
  command(root, ['config', 'user.name', 'Freeway Test']);
  command(root, ['config', 'user.email', 'freeway@example.invalid']);
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'two\n');
  command(root, ['add', 'a.txt', 'b.txt']);
  command(root, ['commit', '-q', '-m', 'initial']);
  return root;
}

test('git_status and git_diff are read-only and bounded', async (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'two\n');
  const status = await gitStatus(root);
  assert.match(status, /a\.txt/);
  assert.match(status, / M a\.txt/);
  const diff = await gitDiff(root, { path: 'a.txt' });
  assert.match(diff, /-one/);
  assert.match(diff, /\+two/);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'two\n');
  const viaTool = await runTool('git_status', {}, { workspace: { isReady: true, root } });
  assert.equal(viaTool.ok, true);
  assert.match(viaTool.content, /a\.txt/);
});

test('git_commit commits only named paths and git_revert restores tracked files', async (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'changed\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'also changed\n');
  const result = await gitCommit(root, { message: 'Change a only', paths: ['a.txt'] });
  assert.match(result.hash, /^[0-9a-f]+$/);
  assert.equal(command(root, ['show', '--format=', '--name-only', 'HEAD']).trim(), 'a.txt');
  assert.match(command(root, ['status', '--short']), /M b\.txt/);

  fs.writeFileSync(path.join(root, 'a.txt'), 'scratch\n');
  await gitRevert(root, { paths: ['a.txt'] });
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'changed\n');
});

test('git_revert refuses untracked files instead of deleting them', async (t) => {
  const root = repository(t);
  fs.writeFileSync(path.join(root, 'new.txt'), 'keep me\n');
  await assert.rejects(gitRevert(root, { paths: ['new.txt'] }), /untracked/);
  assert.equal(fs.existsSync(path.join(root, 'new.txt')), true);
});

test('git paths cannot escape the workspace or target .git', () => {
  assert.throws(() => normalizeGitPaths(['../secret']), /inside the workspace/);
  assert.throws(() => normalizeGitPaths(['/etc/passwd']), /relative/);
  assert.throws(() => normalizeGitPaths(['.git/config']), /inside the workspace/);
  assert.throws(() => normalizeGitPaths([]), /at least one/);
  assert.deepEqual(normalizeGitPaths(['lib/a.mjs', './lib/a.mjs']), ['lib/a.mjs']);
});
