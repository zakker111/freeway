import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createCommandRunner } from './commands.mjs';
import { createProcessManager, detectPort, portIsOpen } from './processes.mjs';

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-process-'));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function managerFor(root, overrides = {}) {
  const runner = createCommandRunner({ root, allowlist: 'node' });
  return createProcessManager({ getRunner: () => runner, readyTimeoutMs: 5000, ...overrides });
}

test('detectPort reads the forms dev servers print', () => {
  assert.equal(detectPort('  Local:   http://localhost:5173/'), 5173);
  assert.equal(detectPort('Local:   http://127.0.0.1:4173/'), 4173);
  assert.equal(detectPort('Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...'), 8000);
  assert.equal(detectPort('listening on http://[::1]:4321'), 4321);
  assert.equal(detectPort('Server started in 250 ms'), null);
  assert.equal(detectPort('listening on http://localhost:3002', { exclude: [3002] }), null);
  assert.equal(detectPort(''), null);
});

test('a port split across output chunks is still detected', async () => {
  const root = workspace();
  const port = await freePort();
  const script = `const http = require('node:http'); const server = http.createServer((req, res) => res.end('ok')).listen(${port}, '127.0.0.1', () => { process.stdout.write('Local: http://localhost:'); setTimeout(() => console.log('${port}/'), 80); });`;
  const manager = managerFor(root, { readyTimeoutMs: 3000 });
  const record = await manager.start({ program: 'node', args: ['-e', script] });
  try {
    assert.equal(record.port, port);
    assert.equal(record.ready, true);
    assert.match(manager.logs(record.id).text, new RegExp(`localhost:${port}`));
  } finally {
    await manager.stopAll();
  }
});

test('a started server reports a live port, logs and a clean stop', async () => {
  const root = workspace();
  const port = await freePort();
  // One line: the command runner refuses arguments with newlines.
  const script = `const http = require('node:http'); http.createServer((req, res) => res.end('ok')).listen(${port}, '127.0.0.1', () => console.log('Local: http://localhost:${port}/'));`;
  const manager = managerFor(root);
  assert.equal(await portIsOpen(port), false);
  const record = await manager.start({ program: 'node', args: ['-e', script] });
  try {
    assert.equal(record.status, 'running');
    assert.equal(record.port, port);
    assert.equal(record.ready, true);
    assert.equal(record.url, `http://127.0.0.1:${port}`);
    assert.equal(await portIsOpen(port), true);
    const read = manager.logs(record.id, { bytes: 4000 });
    assert.match(read.text, /Local:/);
    const stopped = await manager.stop(record.id);
    assert.equal(stopped[0].status, 'stopped');
    assert.equal(await portIsOpen(port), false);
    assert.equal(manager.running().length, 0);
  } finally {
    await manager.stopAll();
  }
});

test('an exited program reports its code and output instead of looking alive', async () => {
  const manager = managerFor(workspace());
  const record = await manager.start({
    program: 'node',
    args: ['-e', 'console.error("boom"); process.exit(3)'],
  });
  assert.equal(record.status, 'exited');
  assert.equal(record.exitCode, 3);
  assert.match(manager.logs(record.id).text, /boom/);
});

test('a printed port is not claimed until something listens there', async () => {
  const root = workspace();
  const port = await freePort();
  const manager = managerFor(root, { readyTimeoutMs: 400 });
  const record = await manager.start({
    program: 'node',
    args: ['-e', `console.log('Local: http://localhost:${port}/'); setInterval(() => {}, 1000);`],
  });
  try {
    assert.equal(record.status, 'running');
    assert.equal(record.port, port);
    assert.equal(record.ready, false);
  } finally {
    await manager.stopAll();
  }
});

test('the manager refuses unknown programs, a missing allowlist and too many processes', async () => {
  const root = workspace();
  const manager = managerFor(root, { maxProcesses: 1, readyTimeoutMs: 200 });
  await assert.rejects(() => manager.start({ program: 'definitely-not-allowed' }), /allowlist/);
  const idle = await manager.start({
    program: 'node',
    args: ['-e', 'setInterval(() => {}, 1000);'],
  });
  try {
    await assert.rejects(
      () => manager.start({ program: 'node', args: ['-e', 'setInterval(() => {}, 1000);'] }),
      /Already running/,
    );
  } finally {
    await manager.stopAll();
  }

  const off = createProcessManager({
    getRunner: () => createCommandRunner({ root, allowlist: '' }),
  });
  await assert.rejects(() => off.start({ program: 'node' }), /Running programs is off/);
  assert.equal(manager.logs('dev-404'), null);
  assert.equal(await manager.stop('dev-404'), null);
  assert.match(idle.id, /^dev-\d+$/);
});
