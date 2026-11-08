// Safe, bounded Git operations for the desktop workspace.
//
// These tools intentionally expose only local inspection and the two narrow
// mutations the user approves: committing named paths and restoring tracked
// paths to HEAD. There is no push, reset --hard, clean or shell. Git hooks are
// disabled for commits so a repository cannot run arbitrary code from the
// approval card.

import { spawn } from 'node:child_process';
import fs from 'node:fs';

const GIT_MAX_OUTPUT_BYTES = 64 * 1024;
const GIT_TIMEOUT_MS = 15_000;
const GIT_GIT_MAX_PATHS = 40;
const GIT_MAX_MESSAGE = 500;
const GIT_MAX_PATH = 500;

const GIT_ENV_KEEP = [
  'PATH',
  'Path',
  'PATHEXT',
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'windir',
  'COMSPEC',
  'LANG',
  'LC_ALL',
  'TZ',
  'TEMP',
  'TMP',
  'TMPDIR',
  'APPDATA',
  'LOCALAPPDATA',
];

function gitEnv(source = process.env) {
  const env = { GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' };
  for (const key of GIT_ENV_KEEP) {
    if (typeof source?.[key] === 'string') env[key] = source[key];
  }
  return env;
}

function rootFor(root) {
  if (typeof root !== 'string' || !root.trim()) {
    throw new Error('No workspace folder is set. Ask the user to choose one in Settings.');
  }
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    throw new Error('The workspace folder does not exist.');
  }
  if (!stat.isDirectory()) throw new Error('The workspace path is not a folder.');
  return root;
}

/** Reject absolute paths, traversal, .git internals and control characters. */
export function normalizeGitPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('Name at least one file, relative to the workspace root.');
  }
  if (paths.length > GIT_GIT_MAX_PATHS) throw new Error(`At most ${GIT_GIT_MAX_PATHS} paths can be named at once.`);
  const out = [];
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('Each path must be a non-empty string.');
    const value = raw.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (value.length > GIT_MAX_PATH) throw new Error('A path is too long.');
    if (value.includes('\0') || /[\r\n]/.test(value)) throw new Error('A path contains an invalid character.');
    if (value.startsWith('/') || /^[A-Za-z]:\//.test(value)) throw new Error('Paths must be relative to the workspace.');
    const parts = value.split('/').filter(Boolean);
    if (parts.length === 0 || parts.some((part) => part === '.' || part === '..' || part === '.git')) {
      throw new Error('Paths must stay inside the workspace and cannot point at .git.');
    }
    const clean = parts.join('/');
    if (!out.includes(clean)) out.push(clean);
  }
  return out;
}

function runGit(root, args, { timeoutMs = GIT_TIMEOUT_MS, allowCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn('git', ['--no-pager', ...args], {
        cwd: rootFor(root),
        env: gitEnv(),
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let stdout = '';
    let stderr = '';
    let overflow = false;
    let settled = false;
    let timer = null;
    const collect = (target, chunk) => {
      if (overflow) return;
      const next = `${target}${chunk.toString('utf8')}`;
      if (Buffer.byteLength(next) > GIT_MAX_OUTPUT_BYTES) {
        overflow = true;
        try {
          child.kill?.('SIGKILL');
        } catch {
          /* already gone */
        }
        return;
      }
      if (chunk) target = next;
      return target;
    };
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    timer = setTimeout(() => {
      try {
        child.kill?.('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(new Error(`Git did not finish within ${Math.round(timeoutMs / 1000)} seconds.`));
    }, Math.max(100, timeoutMs));
    timer.unref?.();
    child.once?.('error', (error) => finish(error));
    child.stdout?.on?.('data', (chunk) => {
      const next = collect(stdout, chunk);
      if (next !== undefined) stdout = next;
    });
    child.stderr?.on?.('data', (chunk) => {
      const next = collect(stderr, chunk);
      if (next !== undefined) stderr = next;
    });
    child.once?.('close', (code, signal) => {
      if (overflow) {
        finish(new Error('Git produced more output than can be shown safely. Narrow the diff or file list.'));
        return;
      }
      const exit = code === null ? (signal ? 1 : 0) : code;
      if (!allowCodes.includes(exit)) {
        const detail = (stderr || stdout).trim();
        finish(new Error(detail || `Git exited with code ${exit ?? signal ?? 'unknown'}.`));
        return;
      }
      finish(null, { code: exit, stdout, stderr });
    });
  });
}

function statusError(error) {
  const message = String(error?.message ?? error);
  if (/not a git repository/i.test(message)) {
    return new Error('The workspace is not a Git repository. Run git init first.');
  }
  return new Error(message);
}

/** Read-only working-tree summary. */
export async function gitStatus(root) {
  try {
    const result = await runGit(root, [
      'status',
      '--short',
      '--branch',
      '--untracked-files=all',
    ]);
    return `Git status for the workspace:\n${result.stdout.trim() || '(clean)'}`;
  } catch (error) {
    throw statusError(error);
  }
}

/** Read-only diff, optionally for one path and/or the index. */
export async function gitDiff(root, { path: rawPath, staged = false } = {}) {
  try {
    const args = ['diff', '--no-ext-diff', '--no-color', '--unified=3'];
    if (staged === true) args.push('--cached');
    if (rawPath !== undefined && rawPath !== '') {
      const [clean] = normalizeGitPaths([rawPath]);
      args.push('--', clean);
    }
    const result = await runGit(root, args);
    return result.stdout.trim() || 'No changes.';
  } catch (error) {
    throw statusError(error);
  }
}

/**
 * Commit only the named paths. Other staged files stay staged and are not
 * included. The repository's hooks are disabled so a commit cannot run code
 * beyond what the user approved.
 */
export async function gitCommit(root, { message, paths } = {}) {
  const text = typeof message === 'string' ? message.trim() : '';
  if (!text) throw new Error('A commit message is required.');
  if (text.length > GIT_MAX_MESSAGE) throw new Error(`The commit message is longer than ${GIT_MAX_MESSAGE} characters.`);
  const cleanPaths = normalizeGitPaths(paths);
  try {
    await runGit(root, ['add', '-A', '--', ...cleanPaths]);
    const staged = await runGit(root, ['diff', '--cached', '--quiet', '--', ...cleanPaths], {
      allowCodes: [0, 1],
    });
    if (staged.code === 0) throw new Error('No staged changes in the named paths.');
    const result = await runGit(root, [
      '-c',
      'core.hooksPath=.git/freeway-no-hooks',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--no-verify',
      '-m',
      text,
      '--',
      ...cleanPaths,
    ]);
    const head = await runGit(root, ['rev-parse', '--short', 'HEAD']);
    const summary = result.stdout.trim() || `Committed ${cleanPaths.join(', ')}`;
    return {
      content: `${summary}\nCommit: ${head.stdout.trim()}\nPaths: ${cleanPaths.join(', ')}`,
      hash: head.stdout.trim(),
      paths: cleanPaths,
    };
  } catch (error) {
    if (error?.message && !/No staged changes/.test(error.message)) {
      const detail = String(error.message);
      throw new Error(
        /not a git repository/i.test(detail)
          ? 'The workspace is not a Git repository. Run git init first.'
          : detail,
      );
    }
    throw error;
  }
}

/**
 * Restore tracked files to HEAD in both the index and working tree. Untracked
 * files are refused rather than deleted, so this cannot remove new files.
 */
export async function gitRevert(root, { paths } = {}) {
  const cleanPaths = normalizeGitPaths(paths);
  try {
    for (const file of cleanPaths) {
      const tracked = await runGit(root, ['ls-files', '--error-unmatch', '--', file], {
        allowCodes: [0, 1],
      });
      if (tracked.code !== 0) {
        throw new Error(`/${file} is untracked. Revert will not delete a file that Git does not track.`);
      }
    }
    await runGit(root, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...cleanPaths]);
    return `Reverted ${cleanPaths.length} tracked path(s) to HEAD: ${cleanPaths.join(', ')}`;
  } catch (error) {
    const message = String(error?.message ?? error);
    if (/not a git repository/i.test(message)) throw new Error('The workspace is not a Git repository.');
    throw new Error(message);
  }
}

export const gitLimits = {
  maxOutputBytes: GIT_MAX_OUTPUT_BYTES,
  timeoutMs: GIT_TIMEOUT_MS,
  maxPaths: GIT_GIT_MAX_PATHS,
  maxMessage: GIT_MAX_MESSAGE,
};

