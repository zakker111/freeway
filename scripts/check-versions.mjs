#!/usr/bin/env node
// Fails when any version string disagrees with package.json.
//
// One release touches four files: app.mjs, package.json, cloud/worker.mjs and
// cloud/package.json + cloud/package-lock.json. `release.sh` rewrites them
// together, but a hand edit or a partial release can leave the cloud edition on
// the previous version — which is what happened in 2.33.0, where the Worker
// reported 2.33.0-cloud while its own package still said 2.32.0. Nothing caught
// it, so the drift shipped.
//
// Run it directly or through `npm run check:versions`:
//
//   node scripts/check-versions.mjs [root]
//
// `root` defaults to this repository, which makes the failure path testable
// against a fixture tree. No dependencies; plain Node 20+.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const problems = [];
const checked = [];

const pass = (message) => {
  checked.push(message);
  console.log('PASS ' + message);
};

/** Collect a mismatch instead of throwing, so one run reports every drift. */
const fail = (file, expected, actual) => {
  problems.push(`${file}: expected ${expected}, found ${actual}`);
};

function readText(file) {
  try {
    return readFileSync(join(ROOT, file), 'utf8');
  } catch (error) {
    problems.push(`${file}: ${error.code === 'ENOENT' ? 'missing' : error.message}`);
    return null;
  }
}

function readJson(file) {
  const text = readText(file);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    problems.push(`${file}: not valid JSON (${error.message})`);
    return null;
  }
}

/** The `const VERSION = '…';` line every edition declares. */
function declaredVersion(file) {
  const text = readText(file);
  if (text === null) return null;
  const match = /const VERSION = ['"]([^'"]*)['"];/.exec(text);
  if (!match) {
    problems.push(`${file}: no \`const VERSION = '…';\` line`);
    return null;
  }
  return match[1];
}

const pkg = readJson('package.json');
const version = typeof pkg?.version === 'string' ? pkg.version : '';
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  // Every other expectation derives from this value, so stop rather than print
  // a wall of mismatches caused by one unreadable number.
  console.log('FAIL package.json: version must look like x.y.z, found ' + JSON.stringify(version));
  process.exit(1);
}
pass(`package.json declares ${version}`);

const app = declaredVersion('app.mjs');
if (app !== null) {
  if (app === version) pass(`app.mjs declares ${app}`);
  else fail('app.mjs VERSION', version, app);
}

// The cloud build carries the app version with a suffix, so the two can never
// drift silently; it is compared here because nothing else reads the Worker's
// own constant.
const cloud = declaredVersion('cloud/worker.mjs');
if (cloud !== null) {
  if (cloud === `${version}-cloud`) pass(`cloud/worker.mjs declares ${cloud}`);
  else fail('cloud/worker.mjs VERSION', `${version}-cloud`, cloud);
}

const cloudPkg = readJson('cloud/package.json');
if (cloudPkg) {
  if (cloudPkg.name === 'freeway-cloud') pass('cloud/package.json is freeway-cloud');
  else fail('cloud/package.json name', 'freeway-cloud', JSON.stringify(cloudPkg.name));
  if (cloudPkg.version === version) pass(`cloud/package.json version is ${version}`);
  else fail('cloud/package.json version', version, JSON.stringify(cloudPkg.version));
}

// The lockfile keeps its own copy of the root identity, and `npm ci` installs
// from it. A stale copy here is the drift that shipped with 2.33.0.
const lock = readJson('cloud/package-lock.json');
if (lock) {
  const top = lock.packages?.[''];
  if (!top) problems.push('cloud/package-lock.json: packages[""] is missing');
  const pairs = [
    ['cloud/package-lock.json name', 'freeway-cloud', lock.name],
    ['cloud/package-lock.json version', version, lock.version],
    ['cloud/package-lock.json packages[""].name', 'freeway-cloud', top?.name],
    ['cloud/package-lock.json packages[""].version', version, top?.version],
  ];
  for (const [label, expected, actual] of pairs) {
    if (actual === expected) pass(`${label} is ${expected}`);
    else fail(label, expected, JSON.stringify(actual));
  }
}

// The changelog table is the human-facing index of every release; a version
// without its row is a release nobody can find.
const versions = readText('VERSIONS.md');
if (versions !== null) {
  const escaped = version.replace(/\./g, '\\.');
  if (new RegExp(`^\\|\\s*${escaped}\\s*\\|`, 'm').test(versions)) {
    pass(`VERSIONS.md has a ${version} table row`);
  } else {
    fail('VERSIONS.md', `a table row for ${version}`, 'no matching row');
  }
}

console.log('');
if (problems.length > 0) {
  for (const problem of problems) console.log('FAIL ' + problem);
  console.log(
    `Version check failed: ${problems.length} mismatch(es). ` +
      `package.json is ${version}; rewrite the files above (./release.sh ${version}) or fix the number.`,
  );
  process.exit(1);
}

console.log(`Version check passed: ${version} is consistent across ${checked.length} places.`);
