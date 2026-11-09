// Project discovery and check execution for the desktop workspace.
//
// Detection is read-only and does not run a package manager. run_check only
// runs a script that is already declared in package.json, through the same
// allowlisted command runner as run_tests. The confirmation card shows the
// exact command and the script body, because a package script is arbitrary code.

import { parseTestOutput } from './testparse.mjs';

export const CHECK_KINDS = ['test', 'lint', 'typecheck', 'build'];

const MAX_SCRIPTS = 40;
const MAX_SCRIPT_CHARS = 300;
const MAX_FRAMEWORKS = 20;
const MAX_DIAGNOSTICS = 20;
const MAX_DIAGNOSTIC_CHARS = 300;
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];
const MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);
const FRAMEWORKS = new Map([
  ['next', 'Next.js'],
  ['react', 'React'],
  ['react-dom', 'React'],
  ['vue', 'Vue'],
  ['svelte', 'Svelte'],
  ['astro', 'Astro'],
  ['vite', 'Vite'],
  ['nuxt', 'Nuxt'],
  ['remix', 'Remix'],
  ['@remix-run/react', 'Remix'],
  ['solid-js', 'Solid'],
  ['express', 'Express'],
  ['hono', 'Hono'],
  ['fastify', 'Fastify'],
  ['wrangler', 'Cloudflare Workers'],
  ['typescript', 'TypeScript'],
  ['vitest', 'Vitest'],
  ['jest', 'Jest'],
  ['mocha', 'Mocha'],
  ['playwright', '@playwright/test'],
  ['@playwright/test', 'Playwright'],
  ['eslint', 'ESLint'],
  ['prettier', 'Prettier'],
]);

function projectError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function at(root, name) {
  return root ? `${root}/${name}` : name;
}

function scriptEntries(pkg) {
  const source = pkg?.scripts;
  if (!source || typeof source !== 'object' || Array.isArray(source)) return {};
  const out = {};
  for (const [name, value] of Object.entries(source).slice(0, MAX_SCRIPTS)) {
    if (typeof value !== 'string') continue;
    out[String(name).slice(0, 80)] = value.replace(/\s+/g, ' ').trim().slice(0, MAX_SCRIPT_CHARS);
  }
  return out;
}

function detectManager(pkg, names) {
  const declared = typeof pkg?.packageManager === 'string'
    ? pkg.packageManager.split('@')[0].trim().toLowerCase()
    : '';
  if (MANAGERS.has(declared)) return declared;
  for (const [file, manager] of LOCKFILES) {
    if (names.has(file)) return manager;
  }
  return names.has('package.json') ? 'npm' : null;
}

function scriptFor(scripts, kind) {
  const aliases = {
    test: ['test'],
    lint: ['lint'],
    typecheck: ['typecheck', 'type-check', 'tsc'],
    build: ['build'],
  }[kind];
  return aliases.find((name) => typeof scripts[name] === 'string') ?? null;
}

function commandFor(manager, script) {
  if (!manager) return null;
  if (manager === 'npm' && script === 'test') return { program: 'npm', args: ['test'] };
  return { program: manager, args: ['run', script] };
}

function frameworksFor(pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const found = [];
  for (const name of Object.keys(deps)) {
    const label = FRAMEWORKS.get(name);
    if (label && !found.includes(label)) found.push(label);
    if (found.length >= MAX_FRAMEWORKS) break;
  }
  return found;
}

/** Read-only project facts from one folder in the workspace. */
export function inspectProject(workspace, { path: relativePath = '.' } = {}) {
  if (!workspace?.isReady) {
    throw projectError('No workspace folder is set. Ask the user to choose one in Settings.');
  }
  const folder = workspace.list(relativePath || '.');
  const root = folder.path || '';
  const names = new Set(folder.entries.filter((entry) => entry.type === 'file').map((entry) => entry.name));
  let pkg = null;
  let packageError = null;
  if (names.has('package.json')) {
    try {
      pkg = JSON.parse(workspace.read(at(root, 'package.json')).content);
      if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
        packageError = 'package.json must contain a JSON object.';
        pkg = null;
      }
    } catch (error) {
      packageError = `Could not read package.json: ${error?.message ?? error}`;
    }
  }
  const scripts = scriptEntries(pkg);
  const packageManager = detectManager(pkg, names);
  const checks = [];
  for (const kind of CHECK_KINDS) {
    const script = scriptFor(scripts, kind);
    if (!script) continue;
    const command = commandFor(packageManager, script);
    if (!command) continue;
    checks.push({
      kind,
      script,
      label: `/${at(root, 'package.json')} → ${script}`,
      ...command,
      cwd: root,
      scriptBody: scripts[script],
    });
  }
  return {
    path: root,
    packageFile: at(root, 'package.json'),
    packageManager,
    packageError,
    scripts,
    checks,
    frameworks: frameworksFor(pkg),
  };
}

export function formatProjectInfo(info) {
  const lines = [`Project: /${info.path || '.'}`];
  lines.push(`Package manager: ${info.packageManager ?? 'not detected'}`);
  if (info.packageError) lines.push(`package.json: ${info.packageError}`);
  if (info.frameworks.length > 0) lines.push(`Detected: ${info.frameworks.join(', ')}`);
  const scripts = Object.entries(info.scripts);
  if (scripts.length === 0) {
    lines.push('Scripts: (none detected)');
  } else {
    lines.push('Scripts:');
    for (const [name, body] of scripts) lines.push(`- ${name}: ${body}`);
  }
  if (info.checks.length === 0) {
    lines.push('Available checks: (none detected)');
  } else {
    lines.push('Available checks:');
    for (const check of info.checks) {
      lines.push(`- ${check.kind}: ${check.program} ${check.args.join(' ')} (script: ${check.script})`);
    }
  }
  return lines.join('\n');
}

/** Resolve exactly one detected check; never accept arbitrary program or args. */
export function resolveCheck(workspace, { kind, path: relativePath = '.' } = {}) {
  const wanted = String(kind ?? '').trim().toLowerCase();
  if (!CHECK_KINDS.includes(wanted)) {
    throw projectError(`kind must be one of: ${CHECK_KINDS.join(', ')}.`);
  }
  const info = inspectProject(workspace, { path: relativePath });
  const check = info.checks.find((item) => item.kind === wanted);
  if (!check) {
    const available = info.checks.map((item) => item.kind).join(', ') || 'none';
    throw projectError(
      `No ${wanted} script was found in /${info.packageFile}. Available checks: ${available}.`,
    );
  }
  return check;
}

function pushDiagnostic(list, file, line, column, message) {
  if (list.length >= MAX_DIAGNOSTICS) return;
  const clean = String(message ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_DIAGNOSTIC_CHARS);
  if (!clean) return;
  const item = {
    file: file ? String(file).replace(/\\/g, '/').slice(0, 300) : null,
    line: Number(line) || null,
    column: Number(column) || null,
    message: clean,
  };
  if (!list.some((entry) => entry.file === item.file && entry.line === item.line && entry.message === item.message)) {
    list.push(item);
  }
}

/** Parse tsc/eslint-style diagnostics, or delegate test output to the test parser. */
export function parseCheckOutput(output, { kind = 'test', exitCode = null } = {}) {
  const text = String(output ?? '');
  if (kind === 'test') {
    const parsed = parseTestOutput(text, { exitCode });
    return {
      kind,
      passed: parsed.passed,
      summary: parsed.summary,
      diagnostics: parsed.failures.map((failure) => ({
        file: failure.file,
        line: failure.line,
        column: null,
        message: failure.message,
      })),
    };
  }

  const diagnostics = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\x1b\[[0-9;]*m/g, '').trimEnd();
    let match = /^(.+?)\((\d+),(\d+)\):\s*(?:error|warning)?\s*(.+)$/.exec(line);
    if (match) {
      pushDiagnostic(diagnostics, match[1], match[2], match[3], match[4]);
      continue;
    }
    match = /^(.+?):(\d+):(\d+)\s+(?:error|warning)\s+(.+?)(?:\s{2,}\S+)?$/.exec(line);
    if (match) {
      pushDiagnostic(diagnostics, match[1], match[2], match[3], match[4]);
      continue;
    }
    match = /^(.+?):(\d+):\s*(?:error|warning)\s+(.+)$/.exec(line);
    if (match) pushDiagnostic(diagnostics, match[1], match[2], null, match[3]);
  }

  if (diagnostics.length === 0 && exitCode !== 0 && exitCode !== null) {
    const tail = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-3).join(' ');
    pushDiagnostic(diagnostics, null, null, null, tail || 'the check command exited non-zero');
  }
  return {
    kind,
    passed: exitCode === 0 && diagnostics.length === 0,
    summary: exitCode === 0 && diagnostics.length === 0
      ? `${kind} passed.`
      : `${diagnostics.length || 'Some'} ${kind} problem${diagnostics.length === 1 ? '' : 's'}.`,
    diagnostics,
  };
}

export const projectLimits = {
  maxScripts: MAX_SCRIPTS,
  maxScriptChars: MAX_SCRIPT_CHARS,
  maxDiagnostics: MAX_DIAGNOSTICS,
  maxDiagnosticChars: MAX_DIAGNOSTIC_CHARS,
};
