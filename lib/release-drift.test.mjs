// The release-drift check exists because v2.38.7 shipped and work kept landing:
// the repository was ahead of the only version anyone could download, and CI
// stayed green. These tests pin the rule (ahead is a failure) and the escape
// hatch (a dated, reasoned allowlist entry for a test-only bump).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  compareVersions,
  evaluate,
  parseVersion,
  run,
} from '../scripts/check-release-drift.mjs';

const TODAY = '2026-11-16';

function fixture({ version = '2.38.9', allow } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'drift-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'freeway', version }));
  if (allow) {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    writeFileSync(join(root, 'scripts/release-drift-allowlist.json'), JSON.stringify({ allow }));
  }
  return root;
}

const fakeLatest = (tag) => async () => ({ latest: tag });

test('versions compare numerically, not as strings', () => {
  assert.equal(compareVersions(parseVersion('2.38.9'), parseVersion('2.38.10')), -1);
  assert.equal(compareVersions(parseVersion('2.9.0'), parseVersion('2.10.0')), -1);
  assert.equal(compareVersions(parseVersion('2.38.8'), parseVersion('2.38.8')), 0);
  // A prerelease behaves as older than the release it leads to.
  assert.equal(compareVersions(parseVersion('2.38.9-rc.1'), parseVersion('2.38.9')), -1);
  assert.equal(parseVersion('not-a-version'), null);
});

test('a repository version ahead of the release fails', () => {
  const verdict = evaluate({ version: '2.38.9', latest: 'v2.38.8', allowlist: null, today: TODAY });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /ahead of the latest release v2\.38\.8/);
  assert.doesNotMatch(verdict.message, /vv/);
});

test('a version that matches or trails the release passes', () => {
  assert.equal(evaluate({ version: '2.38.8', latest: 'v2.38.8', today: TODAY }).ok, true);
  assert.equal(evaluate({ version: '2.38.7', latest: 'v2.38.8', today: TODAY }).ok, true);
});

test('an allowlisted test-only bump passes until its expiry', () => {
  const allowlist = { allow: [{ version: '2.38.9', reason: 'test-only bump', until: '2026-12-16' }] };
  const inDate = evaluate({ version: '2.38.9', latest: 'v2.38.8', allowlist, today: TODAY });
  assert.equal(inDate.ok, true);
  assert.equal(inDate.allowed, true);
  assert.match(inDate.message, /allowed until 2026-12-16: test-only bump/);

  const expired = evaluate({ version: '2.38.9', latest: 'v2.38.8', allowlist, today: '2026-12-17' });
  assert.equal(expired.ok, false, 'an expired allowlist entry must stop covering the drift');
});

test('an allowlist entry only covers its own version and must expire', () => {
  const other = { allow: [{ version: '2.38.8', reason: 'x', until: '2026-12-16' }] };
  assert.equal(evaluate({ version: '2.38.9', latest: 'v2.38.7', allowlist: other, today: TODAY }).ok, false);

  const open = { allow: [{ version: '2.38.9', reason: 'no expiry' }] };
  assert.equal(
    evaluate({ version: '2.38.9', latest: 'v2.38.7', allowlist: open, today: TODAY }).ok,
    false,
    'an entry without an expiry would hide the drift for ever',
  );
});

test('no publication yet warns instead of failing', () => {
  const verdict = evaluate({ version: '2.38.9', latest: null, allowlist: null, today: TODAY });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.warned, true);
});

test('the CLI run fails on drift, passes when allowed, and never fails on a network error', async () => {
  const ahead = await run({
    root: fixture({ version: '2.39.0' }),
    repo: 'zakker111/freeway',
    today: TODAY,
    fetchLatest: fakeLatest('v2.38.8'),
  });
  assert.equal(ahead.code, 1, 'a published-off drift must fail the build');
  assert.match(ahead.message, /release drift: FAILED/);

  const allowed = await run({
    root: fixture({
      version: '2.39.0',
      allow: [{ version: '2.39.0', reason: 'test-only bump', until: '2026-12-16' }],
    }),
    repo: 'zakker111/freeway',
    today: TODAY,
    fetchLatest: fakeLatest('v2.38.8'),
  });
  assert.equal(allowed.code, 0);
  assert.match(allowed.message, /release drift: allowed/);

  const offline = await run({
    root: fixture({ version: '2.39.0' }),
    repo: 'zakker111/freeway',
    today: TODAY,
    fetchLatest: async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  assert.equal(offline.code, 0, 'a flaky API must not turn a green branch red');
  assert.match(offline.message, /not failing the build/);

  const noRepo = await run({ root: fixture(), repo: '', today: TODAY });
  assert.equal(noRepo.code, 0);
});

test('the repository allowlist parses and every entry has an expiry', async () => {
  const { readFileSync } = await import('node:fs');
  const allowlist = JSON.parse(readFileSync('scripts/release-drift-allowlist.json', 'utf8'));
  for (const entry of allowlist.allow) {
    assert.equal(typeof entry.version, 'string');
    assert.match(entry.until, /^\d{4}-\d{2}-\d{2}$/, 'every allowlist entry needs a real expiry date');
    assert.ok(entry.reason, 'every allowlist entry needs a reason');
  }
});
