import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createCommandRunner, parseAllowlist, findOnPath } from './commands.mjs';

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-cmd-'));
}

// A child process that never starts: the test feeds it stdout/stderr and an exit.
function fakeSpawn(behaviour) {
  const calls = [];
  const spawn = (program, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      behaviour.afterKill?.(child);
    };
    calls.push({ program, args, options });
    queueMicrotask(() => behaviour.run(child));
    return child;
  };
  return { spawn, calls };
}

test('the allowlist takes names only, never paths', () => {
  assert.deepEqual(parseAllowlist('node, npm  git'), ['node', 'npm', 'git']);
  assert.deepEqual(parseAllowlist('Node NODE node'), ['node']);
  assert.deepEqual(parseAllowlist('/usr/bin/node'), []);
  assert.deepEqual(parseAllowlist('../../evil'), []);
  assert.deepEqual(parseAllowlist('a;b && c'), ['a', 'b', 'c']);
  assert.deepEqual(parseAllowlist(''), []);
  assert.equal(parseAllowlist(Array.from({ length: 40 }, (_, i) => `p${i}`)).length, 20);
});

test('a program that is not allowlisted never reaches spawn', async () => {
  const { spawn, calls } = fakeSpawn({ run: () => {} });
  const runner = createCommandRunner({ root: workspace(), allowlist: 'node', spawn });
  await assert.rejects(() => runner.run({ program: 'curl', args: [] }), /not on the allowlist/);
  assert.equal(calls.length, 0);
});

test('arguments are passed literally with shell:false', async () => {
  const dir = workspace();
  const { spawn, calls } = fakeSpawn({
    run: (child) => {
      child.stdout.emit('data', 'ok\n');
      child.emit('close', 0, null);
    },
  });
  const runner = createCommandRunner({ root: dir, allowlist: 'echo', spawn });
  const result = await runner.run({
    program: 'echo',
    args: ['a && rm -rf /', '$(whoami)', '> out.txt'],
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].program, 'echo');
  assert.deepEqual(calls[0].args, ['a && rm -rf /', '$(whoami)', '> out.txt']);
  assert.equal(calls[0].options.shell, false, 'a shell would turn those arguments into commands');
  assert.equal(calls[0].options.cwd, fs.realpathSync(dir));
});

test('the child does not inherit the app secrets', async () => {
  const { spawn, calls } = fakeSpawn({
    run: (child) => child.emit('close', 0, null),
  });
  const runner = createCommandRunner({
    root: workspace(),
    allowlist: 'node',
    spawn,
    env: {
      PATH: '/usr/bin',
      HOME: '/home/me',
      OPENROUTER_API_KEY: 'sk-or-v1-secret',
      GITHUB_TOKEN: 'ghp_secret',
      RANDOM_THING: 'nope',
    },
  });
  await runner.run({ program: 'node', args: ['-v'] });

  assert.equal(calls[0].options.env.PATH, '/usr/bin');
  assert.equal(calls[0].options.env.HOME, '/home/me');
  assert.equal(calls[0].options.env.OPENROUTER_API_KEY, undefined);
  assert.equal(calls[0].options.env.GITHUB_TOKEN, undefined);
  assert.equal(calls[0].options.env.RANDOM_THING, undefined);
});

test('output is capped and the overflow is flagged', async () => {
  const { spawn } = fakeSpawn({
    run: (child) => {
      child.stdout.emit('data', 'x'.repeat(100));
      child.stderr.emit('data', 'y'.repeat(100));
      child.emit('close', 0, null);
    },
  });
  const runner = createCommandRunner({ root: workspace(), allowlist: 'node', spawn, maxOutput: 120 });
  const chunks = [];
  const result = await runner.run({ program: 'node', args: [] }, (chunk) => chunks.push(chunk.text));

  assert.equal(result.stdout.length + result.stderr.length, 120);
  assert.equal(result.truncated, true);
  assert.equal(chunks.join('').length, 120, 'streamed chunks follow the same cap');
});

test('a slow command is killed and reported as timed out', async () => {
  const { spawn } = fakeSpawn({
    run: () => {},
    afterKill: (child) => child.emit('close', null, 'SIGKILL'),
  });
  const runner = createCommandRunner({ root: workspace(), allowlist: 'node', spawn, timeoutMs: 30 });
  const result = await runner.run({ program: 'node', args: ['-e', 'while(1){}'] });

  assert.equal(result.timedOut, true);
  assert.equal(result.ok, false);
});

test('a non-zero exit is a failure but keeps both streams', async () => {
  const { spawn } = fakeSpawn({
    run: (child) => {
      child.stdout.emit('data', 'out\n');
      child.stderr.emit('data', 'boom\n');
      child.emit('close', 2, null);
    },
  });
  const runner = createCommandRunner({ root: workspace(), allowlist: 'npm', spawn });
  const result = await runner.run({ program: 'npm', args: ['test'] });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, 'out\n');
  assert.equal(result.stderr, 'boom\n');
});

test('a folder outside the workspace is refused', async () => {
  const root = workspace();
  const { spawn, calls } = fakeSpawn({ run: (child) => child.emit('close', 0, null) });
  const runner = createCommandRunner({ root, allowlist: 'node', spawn });

  await assert.rejects(() => runner.run({ program: 'node', args: [], cwd: '..' }), /outside the workspace/);
  assert.equal(calls.length, 0);

  // A symlink pointing out of the root is the same escape, so it is refused too.
  const outside = workspace();
  fs.symlinkSync(outside, path.join(root, 'escape'));
  await assert.rejects(() => runner.run({ program: 'node', args: [], cwd: 'escape' }), /outside the workspace/);
  assert.equal(calls.length, 0);
});

test('bad arguments are rejected before spawn', async () => {
  const { spawn, calls } = fakeSpawn({ run: () => {} });
  const runner = createCommandRunner({ root: workspace(), allowlist: 'node', spawn });

  await assert.rejects(() => runner.run({ program: 'node', args: 'not a list' }), /list of strings/);
  await assert.rejects(() => runner.run({ program: 'node', args: ['ok', 'x'.repeat(600)] }), /too long/);
  await assert.rejects(() => runner.run({ program: 'node', args: ['a\nb'] }), /control characters/);
  await assert.rejects(
    () => runner.run({ program: 'node', args: Array.from({ length: 60 }, () => 'a') }),
    /At most 40 arguments/,
  );
  assert.equal(calls.length, 0);
});

test('no root or no allowlist means it is not ready', () => {
  assert.equal(createCommandRunner({ root: '', allowlist: 'node' }).isReady, false);
  assert.equal(createCommandRunner({ root: workspace(), allowlist: '' }).isReady, false);
  assert.equal(createCommandRunner({ root: workspace(), allowlist: 'node' }).isReady, true);
});

test('a real process runs, streams and exits zero', async () => {
  // process.execPath is a path, so it can never pass the allowlist; "node" is
  // resolved through PATH exactly like a user's own allowlist entry would be.
  const runner = createCommandRunner({ root: workspace(), allowlist: 'node' });
  const chunks = [];
  const result = await runner.run({ program: 'node', args: ['-e', "console.log('hello from a child')"] }, (chunk) =>
    chunks.push(chunk.text),
  );

  assert.equal(result.ok, true, result.error ?? result.stderr);
  assert.match(result.stdout, /hello from a child/);
  assert.ok(chunks.length >= 1, 'output should have been streamed, not only collected');
});

/* ----------------------------------------------------------------- windows */

function windowsDir() {
  const dir = workspace();
  fs.writeFileSync(path.join(dir, 'npm.cmd'), '@echo off\r\n');
  fs.writeFileSync(path.join(dir, 'node.exe'), 'MZ');
  return dir;
}

test('findOnPath tries PATHEXT in order and returns the real file', () => {
  const dir = windowsDir();
  const isFile = (target) => fs.existsSync(target);

  assert.equal(findOnPath('npm', { pathValue: dir, isFile }), path.join(dir, 'npm.cmd'));
  assert.equal(findOnPath('node', { pathValue: dir, isFile }), path.join(dir, 'node.exe'));
  assert.equal(findOnPath('missing', { pathValue: dir, isFile }), null);
  assert.equal(findOnPath('npm', { pathValue: '', isFile }), null);
});

test('a Windows .cmd shim is launched through cmd.exe with literal arguments', async () => {
  const dir = windowsDir();
  const { spawn, calls } = fakeSpawn({ run: (child) => child.emit('close', 0, null) });
  const runner = createCommandRunner({
    root: dir,
    allowlist: 'npm',
    spawn,
    platform: 'win32',
    env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
  });

  const result = await runner.run({ program: 'npm', args: ['test', '--', 'a b'] });
  assert.equal(result.ok, true);
  assert.equal(calls[0].program, 'C:\\Windows\\System32\\cmd.exe');
  assert.equal(calls[0].args[0], '/d');
  assert.equal(calls[0].args[3].includes('npm.cmd'), true);
  assert.match(calls[0].args[3], /"a b"/, 'spaces inside one argument must survive');
  assert.equal(calls[0].options.shell, false, 'still never a shell');
  assert.equal(calls[0].options.windowsVerbatimArguments, true);
});

test('a Windows .cmd shim refuses characters cmd.exe would interpret', async () => {
  const dir = windowsDir();
  const { spawn, calls } = fakeSpawn({ run: () => {} });
  const runner = createCommandRunner({
    root: dir,
    allowlist: 'npm',
    spawn,
    platform: 'win32',
    env: { PATH: dir, ComSpec: 'cmd.exe' },
  });

  await assert.rejects(() => runner.run({ program: 'npm', args: ['test', '&& del x'] }), /\.cmd script/);
  assert.equal(calls.length, 0);
  assert.equal(runner.check({ program: 'npm', args: ['run', 'build'] }).located.kind, 'shim');
});

test('a Windows .exe runs directly, without cmd.exe', async () => {
  const dir = windowsDir();
  const { spawn, calls } = fakeSpawn({ run: (child) => child.emit('close', 0, null) });
  const runner = createCommandRunner({
    root: dir,
    allowlist: 'node',
    spawn,
    platform: 'win32',
    env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD', ComSpec: 'cmd.exe' },
  });

  await runner.run({ program: 'node', args: ['-v'] });
  assert.equal(calls[0].program, path.join(dir, 'node.exe'));
  assert.deepEqual(calls[0].args, ['-v']);
  assert.equal(calls[0].options.windowsVerbatimArguments, undefined);
});

test('unix is untouched: the program name goes to spawn as given', async () => {
  const { spawn, calls } = fakeSpawn({ run: (child) => child.emit('close', 0, null) });
  const runner = createCommandRunner({ root: workspace(), allowlist: 'npm', spawn, platform: 'linux' });
  await runner.run({ program: 'npm', args: ['test'] });
  assert.equal(calls[0].program, 'npm');
  assert.deepEqual(calls[0].args, ['test']);
});
