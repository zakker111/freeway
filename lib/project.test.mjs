import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from './workspace.mjs';
import { inspectProject, resolveCheck, parseCheckOutput } from './project.mjs';
import { runTool } from './tools.mjs';

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-project-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return { root, ws: createWorkspace(root) };
}

test('project_info detects a pnpm project, scripts, framework and checks', () => {
  const { ws } = fixture({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest', lint: 'eslint .', typecheck: 'tsc --noEmit', build: 'vite build' },
      devDependencies: { vite: '^5.0.0', typescript: '^5.0.0' },
    }),
    'pnpm-lock.yaml': 'lockfileVersion: 9\n',
  });
  const info = inspectProject(ws);
  assert.equal(info.packageManager, 'pnpm');
  assert.deepEqual(info.frameworks.sort(), ['TypeScript', 'Vite']);
  assert.deepEqual(info.checks.map((check) => check.kind), ['test', 'lint', 'typecheck', 'build']);
  assert.deepEqual(
    info.checks.map((check) => `${check.program} ${check.args.join(' ')}`),
    ['pnpm run test', 'pnpm run lint', 'pnpm run typecheck', 'pnpm run build'],
  );
  assert.match(info.checks[0].scriptBody, /vitest/);
});

test('project_info tolerates a missing or invalid manifest', () => {
  const { ws } = fixture({ 'package.json': '{not json' });
  const info = inspectProject(ws);
  assert.match(info.packageError, /Could not read package\.json/);
  assert.deepEqual(info.scripts, {});
  assert.equal(info.checks.length, 0);
  const escaped = fixture({});
  assert.deepEqual(inspectProject(escaped.ws).scripts, {});
});

test('resolveCheck only returns a declared script and a closed kind', () => {
  const { ws } = fixture({
    'package.json': JSON.stringify({ scripts: { test: 'node --test' } }),
  });
  assert.equal(resolveCheck(ws, { kind: 'test' }).script, 'test');
  assert.throws(() => resolveCheck(ws, { kind: 'deploy' }), /kind must be one of/);
  assert.throws(() => resolveCheck(ws, { kind: 'lint' }), /No lint script/);
});

test('parseCheckOutput reads tsc and eslint locations and failures', () => {
  const tsc = parseCheckOutput(
    'src/a.ts(3,7): error TS1005: expected a semicolon\nsrc/b.ts(1,2): warning TS9999: note',
    { kind: 'typecheck', exitCode: 1 },
  );
  assert.equal(tsc.passed, false);
  assert.deepEqual(tsc.diagnostics[0], {
    file: 'src/a.ts', line: 3, column: 7, message: 'TS1005: expected a semicolon',
  });
  assert.equal(tsc.diagnostics.length, 2);

  const eslint = parseCheckOutput(
    'src/a.js:4:9  error  Unexpected var  no-var\n\n1 problem',
    { kind: 'lint', exitCode: 1 },
  );
  assert.equal(eslint.diagnostics[0].file, 'src/a.js');
  assert.equal(eslint.diagnostics[0].line, 4);
  assert.equal(eslint.passed, false);
  assert.match(eslint.diagnostics[0].message, /Unexpected var/);

  assert.equal(parseCheckOutput('', { kind: 'build', exitCode: 0 }).passed, true);
  assert.match(parseCheckOutput('boom', { kind: 'build', exitCode: 2 }).diagnostics[0].message, /boom/);
});

test('run_check uses only the detected command and reports diagnostics', async () => {
  const { ws } = fixture({
    'package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit' } }),
    'package-lock.json': '{}',
  });
  const calls = [];
  const commands = {
    isReady: true,
    async run(input) {
      calls.push(input);
      return {
        ok: false,
        exitCode: 1,
        stdout: 'src/a.ts(2,4): error TS2304: Cannot find name x',
        stderr: '',
        truncated: false,
        timedOut: false,
        program: input.program,
        args: input.args,
      };
    },
  };
  const result = await runTool('run_check', { kind: 'typecheck' }, { workspace: ws, commands });
  assert.equal(result.ok, false);
  assert.deepEqual(calls, [{ program: 'npm', args: ['run', 'typecheck'], cwd: '' }]);
  assert.match(result.content, /\$ npm run typecheck/);
  assert.match(result.content, /script typecheck: tsc --noEmit/);
  assert.match(result.content, /TS2304/);

  const info = await runTool('project_info', {}, { workspace: ws });
  assert.equal(info.ok, true);
  assert.match(info.content, /Package manager: npm/);
  assert.match(info.content, /Available checks:/);
});
