#!/usr/bin/env node
// Launches the packaged client and requires it to answer /api/config and serve
// the page. The Windows ZIP is this one binary with Node inside, so it is the
// only thing in the download that a user actually runs; asserting the source
// tree's app.mjs says nothing about it.
//
//   node scripts/smoke-windows-client.mjs                # ./Freeway.exe
//   node scripts/smoke-windows-client.mjs -- node freeway.cjs
//
// Everything after `--` is the command to launch; this script appends --host,
// --port and --config. The expected version comes from package.json, so the
// binary has to be the one this checkout describes.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

const argv = process.argv.slice(2);
const split = argv.indexOf('--');
const command = split >= 0 ? argv.slice(split + 1) : [path.join(root, 'Freeway.exe')];
if (command.length === 0) {
  console.error('Usage: node scripts/smoke-windows-client.mjs [-- <command> ...]');
  process.exit(2);
}

const [file, ...prefix] = command;
const label = command.map((part) => path.basename(part)).join(' ');

function fail(message, output = '') {
  console.error(`FAIL packaged client (${label}): ${message}`);
  if (output.trim()) console.error('--- client output ---\n' + output.slice(-4000));
  process.exit(1);
}

// The binary has to report the version it was built from before it is launched:
// a stale blob answers /api/config convincingly, just for the wrong release.
const versionRun = spawnSync(file, [...prefix, '--version'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NO_OPEN: '1' },
  timeout: 60_000,
  windowsHide: true,
});
if (versionRun.error) fail(`could not run --version: ${versionRun.error.message}`);
if (versionRun.status !== 0) {
  fail(`--version exited ${versionRun.status}`, `${versionRun.stdout || ''}${versionRun.stderr || ''}`);
}
if (!String(versionRun.stdout || '').includes(version)) {
  fail(`--version did not report ${version}`, `${versionRun.stdout || ''}${versionRun.stderr || ''}`);
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-smoke-'));
const port = await freePort();
const configPath = path.join(temp, 'config.json');
const client = spawn(
  file,
  [...prefix, '--host', '127.0.0.1', '--port', String(port), '--config', configPath],
  {
    cwd: root,
    env: { ...process.env, NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let output = '';
client.stdout.on('data', (chunk) => (output += chunk));
client.stderr.on('data', (chunk) => (output += chunk));
let exited = null;
client.on('exit', (code, signal) => {
  exited = { code, signal };
});

function stop() {
  if (exited) return;
  client.kill('SIGKILL');
}
process.on('exit', stop);
process.on('SIGINT', () => {
  stop();
  process.exit(130);
});

const base = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 30_000;
let served = null;
while (Date.now() < deadline) {
  if (exited) break;
  try {
    const response = await fetch(`${base}/api/config`);
    if (response.ok) {
      served = await response.json();
      break;
    }
  } catch {
    // Not listening yet; the loop below keeps trying until the deadline.
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}

if (!served) {
  stop();
  fail(
    exited
      ? `exited (${exited.code ?? exited.signal}) before answering /api/config`
      : `did not answer /api/config on ${base}`,
    output,
  );
}
if (served.version !== version) {
  stop();
  fail(`reported ${served.version}, expected ${version}`, output);
}

let page;
try {
  page = await fetch(`${base}/`, { signal: AbortSignal.timeout(10_000) });
} catch (error) {
  stop();
  fail(`served /api/config but not the page: ${error.message}`, output);
}
const html = await page.text();
if (page.status !== 200 || !/<title>Freeway/i.test(html)) {
  stop();
  fail(`served HTTP ${page.status} and ${html.length} bytes without the app page`, output);
}

stop();
await new Promise((resolve) => setTimeout(resolve, 200));
fs.rmSync(temp, { recursive: true, force: true });
console.log(`Packaged client (${label}) served ${served.version} and the page on ${base}.`);
