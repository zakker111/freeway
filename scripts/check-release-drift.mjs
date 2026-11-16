#!/usr/bin/env node
// Fails when package.json is ahead of the newest published GitHub release.
//
// 2.38.7 shipped a release and then kept landing work: by the time anyone
// downloaded Freeway, the repository said something newer than the newest
// download, so every report was about code nobody could install. The CI run
// that had just gone green never said a word, because nothing compared the two.
//
// A version that is deliberately ahead for a test-only bump can be allowed in
// scripts/release-drift-allowlist.json, with a reason and an expiry date:
//
//   { "allow": [ { "version": "2.38.9", "reason": "test-only bump", "until": "2026-12-16" } ] }
//
// A network or API failure warns and passes: a flaky GitHub API must not turn a
// green branch red. Run it directly or through `npm run check:drift`:
//
//   node scripts/check-release-drift.mjs [root]
//
// `GH_TOKEN` (or `GITHUB_TOKEN`) is used when present; the public API works
// without one, just with a lower rate limit.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(HERE, '..');

export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text ?? '').trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}

/** -1 when a < b, 0 when equal, 1 when a > b. A prerelease sorts below its release. */
export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.pre === b.pre) return 0;
  if (a.pre === null) return 1;
  if (b.pre === null) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function allowedEntry(allowlist, version, today) {
  const entries = Array.isArray(allowlist?.allow) ? allowlist.allow : [];
  return (
    entries.find(
      (entry) =>
        entry &&
        String(entry.version) === String(version) &&
        // An entry without an expiry is a mistake, not an exemption: it would
        // hide the drift for ever, which is exactly what this check exists to
        // stop.
        typeof entry.until === 'string' &&
        entry.until >= today,
    ) ?? null
  );
}

/**
 * Decide from plain values so the rules are testable without a network.
 * `latest` is the newest published release tag, or null when there is none.
 */
export function evaluate({ version, latest, allowlist, today }) {
  const repoVersion = parseVersion(version);
  if (!repoVersion) {
    return { ok: false, message: `package.json version "${version}" is not a version number.` };
  }
  const publishedVersion = parseVersion(latest);
  if (!publishedVersion) {
    return {
      ok: true,
      warned: true,
      message: `there is no published release to compare with (${latest ?? 'none yet'}), so v${version} cannot be checked.`,
    };
  }
  const tag = `v${String(latest).replace(/^v/, '')}`;
  const diff = compareVersions(repoVersion, publishedVersion);
  if (diff <= 0) {
    const same = diff === 0 ? 'matches' : 'is behind';
    return { ok: true, message: `v${version} ${same} the latest release ${tag}.` };
  }
  const entry = allowedEntry(allowlist, version, today);
  if (entry) {
    return {
      ok: true,
      allowed: true,
      message: `v${version} is ahead of the latest release ${tag}, allowed until ${entry.until}: ${entry.reason || 'no reason given'}.`,
    };
  }
  return {
    ok: false,
    message:
      `v${version} is ahead of the latest release ${tag}. ` +
      'Publish that version, or allow it in scripts/release-drift-allowlist.json ' +
      'with a reason and an expiry date when the bump is test-only.',
  };
}

async function fetchLatestRelease(repo, token) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'freeway-release-drift',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return { latest: null, note: 'no published release' };
  if (!response.ok) throw new Error(`GitHub API replied ${response.status}`);
  const body = await response.json();
  return { latest: typeof body?.tag_name === 'string' ? body.tag_name : null };
}

/**
 * Run the check. `fetchLatest` is injectable so a test can simulate the API
 * without touching the network.
 */
export async function run({
  root = DEFAULT_ROOT,
  repo = process.env.GITHUB_REPOSITORY || '',
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '',
  today = new Date().toISOString().slice(0, 10),
  fetchLatest = fetchLatestRelease,
} = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  let allowlist = { allow: [] };
  try {
    allowlist = JSON.parse(readFileSync(join(root, 'scripts/release-drift-allowlist.json'), 'utf8'));
  } catch {
    /* no allowlist is the normal case */
  }

  if (!repo) {
    return { code: 0, message: 'release drift: no repository to check (GITHUB_REPOSITORY is unset).' };
  }

  let latest = null;
  let note = '';
  try {
    const result = await fetchLatest(repo, token);
    latest = result?.latest ?? null;
    note = result?.note ?? '';
  } catch (error) {
    return {
      code: 0,
      message: `release drift: could not read the latest release (${error?.message || error}); not failing the build.`,
    };
  }

  const verdict = evaluate({ version: pkg.version, latest, allowlist, today });
  const label = verdict.ok ? (verdict.allowed ? 'allowed' : 'ok') : 'FAILED';
  const suffix = note && !latest ? ` (${note})` : '';
  return { code: verdict.ok ? 0 : 1, message: `release drift: ${label} — ${verdict.message}${suffix}` };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run({ root: process.argv[2] ? resolve(process.argv[2]) : DEFAULT_ROOT }).then(({ code, message }) => {
    console.log(message);
    process.exitCode = code;
  });
}
