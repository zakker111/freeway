// Running one allowlisted program inside the workspace.
//
// Three decisions do most of the safety work here:
//   1. shell:false always, so there is no shell to quote for and no way to chain
//      "a && b", pipe output or redirect files — every argument is a literal.
//   2. The program name must be on the user's allowlist; a path, "..", a slash or
//      a shell metacharacter can never be a program name.
//   3. The child gets a filtered environment, so the OpenRouter key, a GitHub
//      token or anything else the app holds is not inherited by a script.
// The user still approves every call before it starts.

import fs from 'node:fs';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

const CMD_MAX_ARGS = 40;
const CMD_MAX_ARG_CHARS = 500;
const CMD_MAX_OUTPUT_BYTES = 64 * 1024;
const CMD_TIMEOUT_MS = 60_000;
const CMD_MAX_PROGRAMS = 20;

// A compiler or test runner needs to find its own tools. Nothing here carries a
// credential, and everything else (including OPENROUTER_API_KEY) is dropped.
const CMD_ENV_KEEP = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'SHELL',
  'COMSPEC',
  'PATHEXT',
  'NODE_ENV',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramData',
  'PWD',
];

function commandError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

/** "node, npm git" → ['node', 'npm', 'git']. Paths and punctuation are dropped. */
export function parseAllowlist(input) {
  const source = Array.isArray(input) ? input.join(',') : String(input ?? '');
  const names = source
    .split(/[\s,;]+/)
    .map((name) => name.trim().toLowerCase())
    .filter((name) => /^[a-z0-9._-]{1,40}$/.test(name) && !name.includes('..'));
  return [...new Set(names)].slice(0, CMD_MAX_PROGRAMS);
}

function realOrResolved(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

function insideRoot(root, candidate) {
  return candidate === root || candidate.startsWith(root + path.sep);
}

// Windows cannot execute a .cmd/.bat shim directly, and npm, npx, tsc and most
// other CLIs are exactly that. They have to go through cmd.exe, so their
// arguments are refused if they would mean anything to cmd.
const WINDOWS_SHIM = /\.(cmd|bat)$/i;
const SHIM_FORBIDDEN = /[&|<>^"%()!]/;

/** First `program.exe`/`.cmd`/... on PATH, the way Windows itself looks. */
export function findOnPath(
  program,
  { pathValue = '', pathExt = '.COM;.EXE;.BAT;.CMD', isFile = () => false } = {},
) {
  const extensions = String(pathExt || '')
    .split(';')
    .map((ext) => ext.trim())
    .filter(Boolean);
  for (const dir of String(pathValue || '').split(';').filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, `${program}${ext.toLowerCase()}`);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

const quoteForCmd = (value) => (/\s/.test(value) ? `"${value}"` : value);

/**
 * `spawn` and `env` are injectable so the tests can assert exactly what would be
 * executed without starting a process per case.
 */
export function createCommandRunner({
  root,
  allowlist = [],
  timeoutMs = CMD_TIMEOUT_MS,
  maxOutput = CMD_MAX_OUTPUT_BYTES,
  spawn = nodeSpawn,
  env = process.env,
  platform = process.platform,
  isFile = (target) => {
    try {
      return fs.statSync(target).isFile();
    } catch {
      return false;
    }
  },
} = {}) {
  const base = root ? realOrResolved(root) : null;
  const allowed = parseAllowlist(allowlist);
  const isReady = Boolean(base) && allowed.length > 0;

  const cleanEnv = {};
  for (const key of CMD_ENV_KEEP) {
    if (typeof env[key] === 'string') cleanEnv[key] = env[key];
  }

  // Where the program actually is. Unix leaves it to PATH lookup; Windows needs
  // PATHEXT so "npm" can become npm.cmd, and those shims need cmd.exe.
  function locate(program) {
    if (platform !== 'win32') return { command: program, kind: 'direct' };
    const found = findOnPath(program, {
      pathValue: env.PATH ?? env.Path ?? '',
      pathExt: env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
      isFile,
    });
    if (!found) return { command: program, kind: 'direct' };
    if (WINDOWS_SHIM.test(found)) {
      return { command: found, kind: 'shim', shell: env.ComSpec || env.COMSPEC || 'cmd.exe' };
    }
    return { command: found, kind: 'direct' };
  }

  // Rejects the request or returns the exact { program, args } to spawn.
  function check(input = {}) {
    if (!base) throw commandError('No workspace folder is set. Choose one in Settings.');
    if (allowed.length === 0) throw commandError('No commands are allowed. Add a program in Settings.');

    const program = String(input.program ?? '').trim().toLowerCase();
    if (!program) throw commandError('A program name is required.');
    if (!allowed.includes(program)) {
      throw commandError(
        `"${program}" is not on the allowlist (${allowed.join(', ')}). Ask the user to add it in Settings.`,
      );
    }

    const rawArgs = input.args ?? [];
    if (!Array.isArray(rawArgs)) throw commandError('args must be a list of strings.');
    if (rawArgs.length > CMD_MAX_ARGS) throw commandError(`At most ${CMD_MAX_ARGS} arguments.`);
    const args = rawArgs.map((value) => {
      const text = typeof value === 'number' ? String(value) : value;
      if (typeof text !== 'string') throw commandError('args must be a list of strings.');
      if (text.length > CMD_MAX_ARG_CHARS) throw commandError('An argument is too long.');
      if (/[\0\n\r]/.test(text)) throw commandError('Arguments cannot contain control characters.');
      return text;
    });

    const located = platform === 'win32' ? locate(program) : { command: program, kind: 'direct' };
    if (located.kind === 'shim') {
      for (const arg of args) {
        if (SHIM_FORBIDDEN.test(arg)) {
          throw commandError(
            `"${program}" is a Windows .cmd script, so an argument cannot contain & | < > ^ " % ( ) !`,
          );
        }
      }
    }

    const wanted = String(input.cwd ?? '').trim() || '.';
    if (wanted.includes('\0')) throw commandError('Invalid folder.');
    const cwd = realOrResolved(path.resolve(base, wanted));
    if (!insideRoot(base, cwd)) throw commandError('That folder is outside the workspace.');
    let stat;
    try {
      stat = fs.statSync(cwd);
    } catch {
      throw commandError('That folder does not exist.', 404);
    }
    if (!stat.isDirectory()) throw commandError('That is not a folder.');

    return { program, args, cwd, located };
  }

  async function run(input, onOutput) {
    const { program, args, cwd, located } = check(input);
    const started = Date.now();

    return await new Promise((resolve) => {
      let settled = false;
      let child;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve({ program, args, cwd, ms: Date.now() - started, ...result });
      };

      try {
        // The shim runs as one quoted command line; windowsVerbatimArguments keeps
        // Node from re-quoting it, and every argument was checked above.
        const shimLine =
          located.kind === 'shim'
            ? `"${[located.command, ...args].map(quoteForCmd).join(' ')}"`
            : null;
        child =
          located.kind === 'shim'
            ? spawn(located.shell, ['/d', '/s', '/c', shimLine], {
                cwd,
                shell: false,
                windowsHide: true,
                windowsVerbatimArguments: true,
                env: cleanEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
              })
            : spawn(located.command, args, {
                cwd,
                shell: false,
                windowsHide: true,
                env: cleanEnv,
                stdio: ['ignore', 'pipe', 'pipe'],
              });
      } catch (error) {
        finish({ ok: false, exitCode: null, stdout: '', stderr: '', truncated: false, timedOut: false, error: String(error?.message ?? error) });
        return;
      }

      let stdout = '';
      let stderr = '';
      let bytes = 0;
      let truncated = false;
      let timedOut = false;

      // The cap counts both streams together: one chatty command must not be able
      // to grow the response without limit.
      const take = (chunk, isError) => {
        const text = String(chunk);
        const room = maxOutput - bytes;
        const piece = room > 0 ? text.slice(0, room) : '';
        bytes += Buffer.byteLength(piece);
        if (piece.length < text.length) truncated = true;
        if (isError) stderr += piece;
        else stdout += piece;
        if (piece) onOutput?.({ stream: isError ? 'stderr' : 'stdout', text: piece });
      };

      child.stdout?.on('data', (chunk) => take(chunk, false));
      child.stderr?.on('data', (chunk) => take(chunk, true));

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, timeoutMs);

      child.on?.('error', (error) => {
        clearTimeout(timer);
        const message =
          error?.code === 'ENOENT' ? `${program} is not on PATH on this computer.` : String(error?.message ?? error);
        finish({ ok: false, exitCode: null, stdout, stderr, truncated, timedOut, error: message });
      });

      child.on?.('close', (code, signal) => {
        clearTimeout(timer);
        finish({
          ok: code === 0 && !timedOut,
          exitCode: typeof code === 'number' ? code : null,
          signal: signal ?? null,
          stdout,
          stderr,
          truncated,
          timedOut,
        });
      });
    });
  }

  return { isReady, allowed, root: base, run, check, cleanEnv };
}

export const commandLimits = {
  CMD_MAX_ARGS,
  CMD_MAX_ARG_CHARS,
  CMD_MAX_OUTPUT_BYTES,
  CMD_TIMEOUT_MS,
  CMD_MAX_PROGRAMS,
  CMD_ENV_KEEP,
};
