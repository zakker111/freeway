#!/usr/bin/env node
// Cheap repository check: no script may hand a secret to a command as an
// argument. Arguments are world-readable from `ps` for the life of the
// process, which is how the release watcher leaked GH_TOKEN until 2.35.21.
//
// It scans the repository's own scripts and workflows for the common shapes:
//
//   curl -H "authorization: Bearer $GH_TOKEN" ...
//   curl -H "X-Api-Key: $SERVICE_KEY" ...
//   some-cli --token "$GITHUB_TOKEN"
//   curl -u "user:$PASSWORD"
//   git push https://user:$TOKEN@github.com/...
//
// Secrets supplied through the environment, a config file on stdin, or an
// askpass helper are fine: those never reach a command line. Run it with:
//
//   node scripts/check-secrets.mjs
//
// No dependencies, no network. Exit code 1 lists every finding.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'scripts/check-secrets.mjs';
const SKIP_DIRS = new Set(['node_modules', 'dist']);
const SCAN_EXT = new Set(['.sh', '.mjs', '.js', '.cjs', '.yml', '.yaml']);

// A shell variable whose name ends in one of these, or a workflow secret.
// Non-capturing so the pieces can be composed into the rules below.
// The prefix is optional so a bare $PASSWORD or $API_KEY matches too; a greedy
// [A-Z][A-Z0-9_]* would otherwise swallow the suffix word and miss the name.
const SECRET = String.raw`(?:\$(?:\{)?(?:[A-Z][A-Z0-9_]*)?(?:TOKEN|SECRET|PASSWORD|KEY)(?:\})?|\$\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\})`;

const RULES = [
  {
    name: 'authorization header',
    re: new RegExp(String.raw`(?:-H|--header)\s+['"]?authorization:\s*bearer\s+${SECRET}`, 'i'),
  },
  {
    name: 'credential header',
    re: new RegExp(String.raw`(?:-H|--header)\s+['"][A-Za-z0-9-]+:\s*${SECRET}`, 'i'),
  },
  {
    name: 'token flag',
    re: new RegExp(String.raw`(?:--token|--auth-token|--access-token|--password|--api-key|--secret)[=\s]+['"]?${SECRET}`, 'i'),
  },
  {
    name: 'basic auth argument',
    re: new RegExp(String.raw`\s-u\s+['"]?[^'"\s:]+:${SECRET}`, 'i'),
  },
  {
    name: 'credentials in a URL argument',
    re: new RegExp(String.raw`://[^/\s'"@]+:${SECRET}@`, 'i'),
  },
];

function isSecretArgument(line) {
  for (const rule of RULES) {
    if (rule.re.test(line)) return rule.name;
  }
  return '';
}

// Prove the detector still works before trusting a clean scan: a regex typo
// would otherwise report every file as safe forever.
function selfTest() {
  const bad = [
    'curl -fsS -H "authorization: Bearer $GH_TOKEN" https://api.github.com/x',
    'curl -H "X-Api-Key: $SERVICE_KEY" https://example.test',
    'deploy --token "$DEPLOY_TOKEN" --env production',
    'curl --header "authorization: Bearer ${{ secrets.GITHUB_TOKEN }}" https://api.github.com',
    'curl -u "user:$PASSWORD" https://example.test',
    'git push https://x-access-token:$GITHUB_TOKEN@github.com/owner/repo.git',
  ];
  const good = [
    "printf 'header = \"Authorization: Bearer %s\"' \"$GH_TOKEN\" | curl -K - https://api.github.com/x",
    'GIT_ASKPASS="$HELPER" git push https://github.com/owner/repo.git',
    'if [ -z "${GH_TOKEN:-}" ]; then echo "set GH_TOKEN"; fi',
    'git push https://github.com/owner/repo.git',
  ];
  const misses = bad.filter((line) => !isSecretArgument(line));
  const falseAlarms = good.filter((line) => isSecretArgument(line));
  if (misses.length) throw new Error(`self-test missed: ${misses[0]}`);
  if (falseAlarms.length) throw new Error(`self-test false alarm: ${falseAlarms[0]}`);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.git') && entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const dot = entry.name.lastIndexOf('.');
    if (dot < 0 || !SCAN_EXT.has(entry.name.slice(dot))) continue;
    yield full;
  }
}

function main() {
  selfTest();
  const findings = [];
  let scanned = 0;

  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (rel === SELF || rel.startsWith('dist/')) continue;
    let text;
    try {
      if (statSync(file).size > 512 * 1024) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    scanned += 1;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const trimmed = line.trimStart();
      if (trimmed.startsWith('#')) continue;
      const rule = isSecretArgument(line);
      if (!rule) continue;
      findings.push({ rel, line: index + 1, rule, text: trimmed.slice(0, 160) });
    }
  }

  if (findings.length) {
    for (const finding of findings) {
      console.log(`FAIL ${finding.rel}:${finding.line} — ${finding.rule} puts a secret in a command argument`);
      console.log(`     ${finding.text}`);
    }
    console.log(`\n${findings.length} finding(s) in ${scanned} scanned files.`);
    console.log('Pass secrets through the environment, a config file on stdin, or an askpass helper instead.');
    process.exitCode = 1;
    return;
  }

  console.log(`OK ${scanned} script and workflow files: no secret is passed as a command argument`);
}

try {
  main();
} catch (cause) {
  console.error(`secret check crashed: ${cause.message}`);
  process.exitCode = 1;
}
