// Clone one GitHub repository into the workspace without ever putting the
// token in the URL, the command line, or the cloned repository's git config.
//
// The token is passed to git through a process-only credential helper. Global
// and system git config are disabled for this child so a local url.*.insteadOf
// rule cannot redirect the credential to another host.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeRepo } from './github.mjs';

const GITHUB_CLONE_TIMEOUT_MS = 180_000;
const GITHUB_CLONE_MAX_OUTPUT = 64 * 1024;
const GITHUB_CLONE_MAX_FOLDER = 120;
const GITHUB_CLONE_MAX_TOKEN = 1024;
const GITHUB_CLONE_MAX_ERROR = 1200;

const GITHUB_CLONE_ENV_KEEP = [
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
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'GIT_SSL_CAINFO',
];

function githubCloneBad(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function githubCloneOutput(value) {
  return String(value ?? '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, GITHUB_CLONE_MAX_ERROR);
}

function githubCloneToken(value) {
  const token = typeof value === 'string' ? value.trim() : '';
  if (!token) {
    throw githubCloneBad('Connect GitHub in the GitHub panel before cloning.');
  }
  if (token.length > GITHUB_CLONE_MAX_TOKEN || !/^[A-Za-z0-9_.-]+$/.test(token)) {
    throw githubCloneBad('That GitHub token has an unexpected format. Reconnect GitHub and try again.');
  }
  return token;
}

function githubCloneRoot(value) {
  const root = typeof value === 'string' ? value.trim() : '';
  if (!root) {
    throw githubCloneBad('No workspace folder is set. Ask the user to choose one in Settings.');
  }
  let real;
  try {
    real = fs.realpathSync(root);
  } catch {
    throw githubCloneBad('The workspace folder does not exist.');
  }
  if (!fs.statSync(real).isDirectory()) {
    throw githubCloneBad('The workspace path is not a folder.');
  }
  return real;
}

function githubCloneExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw githubCloneBad('That destination folder could not be checked.');
  }
}

/**
 * Validate the repository and destination before touching the disk. A clone is
 * always one new folder directly inside the workspace, never an existing one.
 */
export function resolveGithubCloneTarget(rootInput, repoInput, folderInput) {
  const root = githubCloneRoot(rootInput);
  const repo = normalizeRepo(repoInput);
  const repoName = repo.slice(repo.indexOf('/') + 1);
  const requested = folderInput === undefined || folderInput === null ? '' : String(folderInput).trim();
  const folder = requested || repoName;

  if (folder.length > GITHUB_CLONE_MAX_FOLDER) {
    throw githubCloneBad(`That folder name is too long (${GITHUB_CLONE_MAX_FOLDER} characters maximum).`);
  }
  if (folder === '.' || folder === '..' || folder === '.git') {
    throw githubCloneBad('Choose a normal folder name inside the workspace.');
  }
  // Reject separators, control characters and characters Windows cannot use.
  // Keeping the destination to one segment also guarantees path.resolve cannot
  // walk out of the workspace.
  if (/[\/\\<>:"|?*\u0000-\u001f]/.test(folder) || /^\s|[. ]$/.test(folder)) {
    throw githubCloneBad('Choose one folder name with no slashes or special characters.');
  }

  const target = path.resolve(root, folder);
  if (path.dirname(target) !== root) {
    throw githubCloneBad('The clone folder must be directly inside the workspace.');
  }
  if (githubCloneExists(target)) {
    throw githubCloneBad(`A folder named "${folder}" already exists. Choose another name.`);
  }
  return { root, repo, folder, target };
}

/** Git arguments, kept separate from the environment that holds the token. */
export function githubCloneArgs(repo, target) {
  const helper =
    '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$FREEWAY_GITHUB_TOKEN"; }; f';
  return [
    '-c',
    'credential.helper=',
    '-c',
    `credential.helper=${helper}`,
    'clone',
    '--depth=1',
    '--single-branch',
    '--',
    `https://github.com/${repo}.git`,
    target,
  ];
}

function githubCloneEnv(token, source = process.env) {
  const env = {
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: os.devNull,
    GIT_CONFIG_GLOBAL: os.devNull,
    FREEWAY_GITHUB_TOKEN: token,
  };
  for (const key of GITHUB_CLONE_ENV_KEEP) {
    if (typeof source?.[key] === 'string') env[key] = source[key];
  }
  return env;
}

function githubCloneRun({ git, args, cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(git, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    let output = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const append = (chunk) => {
      if (truncated) return;
      output += chunk.toString('utf8');
      if (Buffer.byteLength(output) > GITHUB_CLONE_MAX_OUTPUT) {
        truncated = true;
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }
    };

    timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, timeoutMs);

    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => finish({ code, output, truncated, timedOut }));
  });
}

function githubCloneRemove(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    /* best effort: a failed clone must not turn into a second error */
  }
}

/**
 * Clone the latest commit of one repository. `run` is injectable so tests can
 * assert the command and environment without network access.
 */
export async function cloneGithubRepo(options = {}) {
  const {
    root,
    token,
    repo,
    folder,
    run = githubCloneRun,
    git = 'git',
    timeoutMs = GITHUB_CLONE_TIMEOUT_MS,
  } = options;

  const credential = githubCloneToken(token);
  const subject = resolveGithubCloneTarget(root, repo, folder);
  const args = githubCloneArgs(subject.repo, subject.target);

  let result;
  try {
    result = await run({
      git,
      args,
      cwd: subject.root,
      env: githubCloneEnv(credential),
      timeoutMs,
    });
  } catch (error) {
    githubCloneRemove(subject.target);
    throw githubCloneBad(
      `Could not start git to clone ${subject.repo}: ${githubCloneOutput(error?.message ?? error) || 'unknown error'}`,
      502,
    );
  }

  const detail = githubCloneOutput(result?.output).replaceAll(credential, '[redacted]');
  if (result?.timedOut) {
    githubCloneRemove(subject.target);
    throw githubCloneBad(`Cloning ${subject.repo} took too long and was stopped.`, 504);
  }
  if (result?.truncated) {
    githubCloneRemove(subject.target);
    throw githubCloneBad(`Git produced too much output while cloning ${subject.repo}, so the clone was stopped.`, 502);
  }
  if (result?.code !== 0) {
    githubCloneRemove(subject.target);
    throw githubCloneBad(
      `Git could not clone ${subject.repo}${detail ? `: ${detail}` : ` (exit code ${result?.code ?? 'unknown'}).`}`,
      502,
    );
  }
  if (!fs.existsSync(path.join(subject.target, '.git'))) {
    githubCloneRemove(subject.target);
    throw githubCloneBad(`Git finished but ${subject.repo} is not a usable repository.`, 502);
  }

  let files = 0;
  try {
    files = fs.readdirSync(subject.target).filter((name) => name !== '.git').length;
  } catch {
    /* the clone is valid; the count is only informational */
  }
  return {
    repo: subject.repo,
    folder: subject.folder,
    path: subject.folder,
    files,
    shallow: true,
  };
}

function githubCredentialArgs() {
  const helper =
    '!f() { test "$1" = get && printf "username=x-access-token\\npassword=%s\\n" "$FREEWAY_GITHUB_TOKEN"; }; f';
  return ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`];
}

function githubLocalBranchName(value) {
  const branch = String(value ?? '').trim();
  if (
    !branch ||
    branch.length > 200 ||
    !/^[A-Za-z0-9._/-]+$/.test(branch) ||
    branch.startsWith('-') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.includes('//') ||
    branch.includes('..') ||
    branch.includes('@{')
  ) {
    throw githubCloneBad('Use a valid branch name with letters, numbers, dot, underscore, slash or dash.');
  }
  return branch;
}

/** Resolve an existing clone directly inside the workspace. */
function githubLocalFolder(rootInput, folderInput) {
  const root = githubCloneRoot(rootInput);
  const folder = String(folderInput ?? '').trim();
  if (
    !folder ||
    folder.length > GITHUB_CLONE_MAX_FOLDER ||
    folder === '.' ||
    folder === '..' ||
    folder === '.git' ||
    /[\/\\<>:"|?*\u0000-\u001f]/.test(folder) ||
    /^\s|[. ]$/.test(folder)
  ) {
    throw githubCloneBad('Choose one existing clone folder directly inside the workspace.');
  }
  const target = path.resolve(root, folder);
  if (path.dirname(target) !== root || !githubCloneExists(target)) {
    throw githubCloneBad(`No clone named "${folder}" was found directly inside the workspace.`);
  }
  const real = fs.realpathSync(target);
  if (!real.startsWith(root + path.sep) || !fs.statSync(real).isDirectory()) {
    throw githubCloneBad('That clone folder is not safely inside the workspace.');
  }
  if (!fs.existsSync(path.join(real, '.git'))) {
    throw githubCloneBad(`/${folder} is not a git checkout. Clone the repository first.`);
  }
  return { root, folder, target: real };
}

function githubRunDetail(result, token) {
  let detail = githubCloneOutput(result?.output);
  if (token) detail = detail.replaceAll(token, '[redacted]');
  if (result?.timedOut) throw githubCloneBad('The git operation took too long and was stopped.', 504);
  if (result?.truncated) throw githubCloneBad('Git produced too much output, so the operation was stopped.', 502);
  if (result?.code !== 0) {
    throw githubCloneBad(detail || `Git exited with code ${result?.code ?? 'unknown'}.`, 502);
  }
  return detail;
}

async function githubRemoteRepo(target, repoInput, run, git) {
  const result = await run({
    git,
    args: ['remote', 'get-url', 'origin'],
    cwd: target,
    env: githubCloneEnv(''),
    timeoutMs: 15_000,
  });
  const detail = githubRunDetail(result, '');
  const url = detail.split(/\r?\n/).filter(Boolean).pop()?.trim() ?? '';
  if (!/^https:\/\/github\.com\//i.test(url) || url.includes('@')) {
    throw githubCloneBad('This checkout does not use a plain HTTPS github.com origin. Re-clone it through Freeway.');
  }
  let pathPart = url.slice('https://github.com/'.length).replace(/\/+$/, '');
  if (pathPart.toLowerCase().endsWith('.git')) pathPart = pathPart.slice(0, -4);
  const repo = normalizeRepo(pathPart);
  if (repoInput) {
    const expected = normalizeRepo(repoInput);
    if (expected !== repo) {
      throw githubCloneBad(`This checkout belongs to ${repo}, not ${expected}.`);
    }
  }
  return repo;
}

/** Pull the current branch with fast-forward only. */
export async function pullGithubRepo(options = {}) {
  const { root, token, repo, folder, run = githubCloneRun, git = 'git', timeoutMs = GITHUB_CLONE_TIMEOUT_MS } = options;
  const credential = githubCloneToken(token);
  const local = githubLocalFolder(root, folder);
  const remote = await githubRemoteRepo(local.target, repo, run, git);
  const result = await run({
    git,
    args: [...githubCredentialArgs(), 'pull', '--ff-only'],
    cwd: local.target,
    env: githubCloneEnv(credential),
    timeoutMs,
  });
  const detail = githubRunDetail(result, credential);
  return { repo: remote, folder: local.folder, output: detail.slice(0, 800) };
}

/** Push the current branch without force, tags or other refs. */
export async function pushGithubRepo(options = {}) {
  const { root, token, repo, folder, run = githubCloneRun, git = 'git', timeoutMs = GITHUB_CLONE_TIMEOUT_MS } = options;
  const credential = githubCloneToken(token);
  const local = githubLocalFolder(root, folder);
  const remote = await githubRemoteRepo(local.target, repo, run, git);

  const branchResult = await run({
    git,
    args: ['rev-parse', '--abbrev-ref', 'HEAD'],
    cwd: local.target,
    env: githubCloneEnv(''),
    timeoutMs: 15_000,
  });
  const branch = githubLocalBranchName(githubRunDetail(branchResult, '').split(/\r?\n/).filter(Boolean).pop());
  if (branch === 'HEAD') throw githubCloneBad('Check out a branch before pushing.');

  const result = await run({
    git,
    args: [
      ...githubCredentialArgs(),
      'push',
      '--porcelain',
      'origin',
      `HEAD:refs/heads/${branch}`,
    ],
    cwd: local.target,
    env: githubCloneEnv(credential),
    timeoutMs,
  });
  const detail = githubRunDetail(result, credential);
  return { repo: remote, folder: local.folder, branch, output: detail.slice(0, 800) };
}

/** Create or switch a local branch. Nothing is sent to GitHub. */
export async function switchGithubBranch(options = {}) {
  const { root, folder, name, create = true, run = githubCloneRun, git = 'git', timeoutMs = 30_000 } = options;
  const local = githubLocalFolder(root, folder);
  const branch = githubLocalBranchName(name);
  const result = await run({
    git,
    args: ['switch', ...(create !== false ? ['-c'] : []), branch],
    cwd: local.target,
    env: githubCloneEnv(''),
    timeoutMs,
  });
  const detail = githubRunDetail(result, '');
  return {
    folder: local.folder,
    branch,
    created: create !== false,
    output: detail.slice(0, 500),
  };
}
