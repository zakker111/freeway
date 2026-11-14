#!/usr/bin/env node
// Freeway — local chat app for free models across providers, with optional tool calling.
// Binds to 127.0.0.1 only: the API key never leaves this process.

import http from 'node:http';
import { isIP } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { filterModels, buildChain, estimateTokens, supportsParam, cleanImages, toUpstreamMessage } from './lib/models.mjs';
import { compactMessages } from './lib/memory.mjs';
import { TOOL_DEFINITIONS, runTool, parseTextToolCalls, postAsText } from './lib/tools.mjs';
import {
  CROSS_CHAT_TOOL_NAMES,
  CROSS_CHAT_TURN_LIMIT,
  crossChatEnabled,
  formatChatList,
  formatChatTranscript,
} from './lib/chats.mjs';
import { normalizePlan, PLAN_TOOL_NAMES } from './lib/plan.mjs';
import { resolveCheck } from './lib/project.mjs';
import { withToolInstruction } from './lib/tool-prompt.mjs';
import {
  PROVIDERS,
  getProvider,
  keyFor,
  accountFor,
  keyTail,
  modelsUrl,
  chatUrl,
  headersFor,
  isAllowedModel,
  publicView,
  toModelRow,
} from './lib/providers.mjs';
import { openStore } from './lib/store.mjs';
import { scrubSecrets } from './lib/redact.mjs';
import { createWorkspace } from './lib/workspace.mjs';
import { scaffoldLayout } from './lib/scaffold.mjs';
import { createPreviewServer } from './lib/preview-server.mjs';
import { browserEnv, captureScreenshot, screenshotAllowed, screenshotViewport } from './lib/screenshot.mjs';
import { openSecrets } from './lib/secrets.mjs';
import { createGithub } from './lib/github.mjs';
import { cloneGithubRepo, pullGithubRepo, pushGithubRepo, switchGithubBranch } from './lib/github-clone.mjs';
import { createWorkspaceArchive } from './lib/archive.mjs';
import { buildDocx } from './lib/docx.mjs';
import { buildPdf } from './lib/pdf.mjs';
import { createCommandRunner, parseAllowlist } from './lib/commands.mjs';
import { createProcessManager, processLimits } from './lib/processes.mjs';
import { createStatusLog } from './lib/status.mjs';
import { createBrowserManager, browserShouldRecheck } from './lib/browser.mjs';
import { createCheckpointStore } from './lib/checkpoints.mjs';
import { createRepairTracker, REPAIR_MAX_ATTEMPTS } from './lib/repair.mjs';

// import.meta.dirname and AbortSignal.any need Node 20.11. Without this check an
// older Node fails later with a confusing error inside a request instead of a
// sentence the user can act on.
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 20 || (nodeMajor === 20 && nodeMinor < 11)) {
  console.error(`Freeway needs Node.js 20.11 or newer — this is ${process.versions.node}.`);
  console.error('Install the LTS version from https://nodejs.org/en/download and start it again.');
  process.exit(1);
}

/* -------------------------------------------------------------------- cli */

const DEFAULT_PORT = 3002;
const DEFAULT_HOST = '127.0.0.1';

function failCli(message) {
  console.error(message);
  console.error('Run with --help for usage.');
  process.exit(2);
}

function isLoopback(host) {
  const name = String(host ?? '').replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return (
    name === 'localhost' ||
    name === '::1' ||
    name === '0:0:0:0:0:0:0:1' ||
    (isIP(name) === 4 && name.split('.')[0] === '127')
  );
}

/** Parse a Host header without accepting userinfo, paths or whitespace. */
function requestHost(value) {
  const raw = String(value ?? '').trim();
  if (!raw || /[\s/\\]/.test(raw)) return null;
  try {
    const parsed = new URL(`http://${raw}`);
    if (parsed.username || parsed.password) return null;
    return {
      name: parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase(),
      host: parsed.host.toLowerCase(),
    };
  } catch {
    return null;
  }
}

/** Loopback, an IP literal, or an explicitly configured reverse-proxy host. */
function hostAllowed(value) {
  const parsed = requestHost(value);
  if (!parsed) return false;
  if (isLoopback(parsed.name) || isIP(parsed.name) !== 0) return true;
  if (ALLOWED_HOSTS.has(parsed.name)) return true;
  const configured = HOST.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  return !['0.0.0.0', '::'].includes(configured) && parsed.name === configured;
}

/**
 * A browser mutation must come from this exact origin. Requests from a native
 * client (curl, the CLI suite) have no Origin but still need the per-run token.
 * A cross-site fetch is refused even if it somehow learned that token.
 */
function sameOrigin(req) {
  if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  if (String(origin).toLowerCase() === 'null') return false;
  let parsed;
  try {
    parsed = new URL(String(origin));
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const target = requestHost(req.headers.host);
  return Boolean(target && parsed.host.toLowerCase() === target.host);
}

function requireTrustedRequest(req, res) {
  if (!hostAllowed(req.headers.host)) {
    sendJson(res, 403, { error: 'Requests must come from the local Freeway page.' });
    return false;
  }
  if (MUTATING_METHODS.has(req.method) && !sameOrigin(req)) {
    sendJson(res, 403, { error: 'That request did not come from the local Freeway page.' });
    return false;
  }
  return true;
}

function parseArgs(argv) {
  const options = { help: false, version: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);

    const value = () => {
      if (inline) return inline;
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && !/^-?\d/.test(next))) {
        failCli(`${flag} needs a value`);
      }
      i += 1;
      return next;
    };

    if (flag === '--port' || flag === '-p') {
      const input = value();
      const port = Number(input);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        failCli(`Port must be a whole number from 1 to 65535, got "${input}".`);
      }
      options.port = port;
    } else if (flag === '--host') {
      const host = value().trim();
      if (!/^[A-Za-z0-9._:[\]-]+$/.test(host)) {
        failCli(`Host "${host}" is not an address (try 127.0.0.1 or 0.0.0.0).`);
      }
      options.host = host;
    } else if (flag === '--config') {
      options.config = value().trim();
      if (!options.config) failCli('--config needs a path');
    } else if (flag === '--doctor') {
      options.doctor = true;
    } else if (flag === '--help' || flag === '-h') {
      options.help = true;
    } else if (flag === '--version' || flag === '-v') {
      options.version = true;
    } else {
      failCli(`Unknown option: ${arg}`);
    }
  }
  return options;
}

/** $HOST is set to the machine name by some shells, so only accept addresses. */
function envHost() {
  const value = (process.env.HOST || '').trim();
  return /^([A-Za-z0-9._:\[\]-]+)$/.test(value) ? value : undefined;
}

function envPort() {
  const value = Number(process.env.PORT);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined;
}

function printHelp() {
  console.log(`Freeway ${VERSION}

Usage: node app.mjs [options]

Options:
  -p, --port <number>  Port to listen on (default ${DEFAULT_PORT}, or $PORT)
      --host <address> Interface to bind (default ${DEFAULT_HOST}, or $HOST)
      --config <path>  Folder (or .json file) for the key, settings and chats
      --doctor         Check this install and exit (no server, no browser)
  -h, --help           Show this help and exit
  -v, --version        Print the version and exit

Environment:
  OPENROUTER_API_KEY   Key to use instead of the saved one
  OPENROUTER_CONFIG    Config file location
  NO_OPEN=1            Do not open a browser window`);
}

const cli = parseArgs(process.argv.slice(2));
const HOST = cli.host ?? envHost() ?? DEFAULT_HOST;
const PORT = cli.port ?? envPort() ?? DEFAULT_PORT;
// A reverse proxy or tunnel may present a public hostname. It has to be named
// explicitly; accepting every Host header would let a DNS-rebinding page read
// the app token from the HTML and drive the local API.
const ALLOWED_HOSTS = new Set(
  (process.env.FREEWAY_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
const APP_TOKEN = randomBytes(16).toString('hex');
const VERSION = '2.35.15';
const MAX_BODY_BYTES = 8_000_000;
// Chat bodies end up at OpenRouter, so they get a much tighter ceiling than a
// local backup import.
const CHAT_BODY_LIMIT = 1_500_000;
const MAX_INPUT_CHARS = 60_000;
const MAX_ATTEMPTS = 3;
// A model may call one tool per round. The round cap is therefore as large as
// the Build step budget; Plan keeps its original small cap.
const MAX_TOOL_ROUNDS = 40;
const PLAN_TOOL_ROUNDS = 3;
const MAX_TOOL_CALLS = 4;
// A Build turn is a small agent loop, not an unlimited one. These two limits
// bound both the number of tool calls and the wall-clock time the user waits.
const MAX_BUILD_STEPS = 40;
const MAX_BUILD_MS = 15 * 60 * 1000;
// A screenshot is an escalation after the text check, not a per-edit ritual.
const MAX_SCREENSHOTS = 2;
const CATALOG_TTL_MS = 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 120_000;

const configuredMaxTokens = Number(process.env.MAX_OUTPUT_TOKENS);
const DEFAULT_MAX_TOKENS =
  Number.isFinite(configuredMaxTokens) && configuredMaxTokens > 0
    ? Math.min(Math.floor(configuredMaxTokens), 4000)
    : 1200;

const DEFAULT_SETTINGS = {
  systemPrompt: '',
  temperature: null,
  maxTokens: DEFAULT_MAX_TOKENS,
  tools: true,
  showLog: true,
  screenshotChecks: true,
  requestCap: 0,
  // Running programs is the sharpest tool in the app, so it is off until the
  // user turns it on and lists the programs by name.
  allowCommands: false,
  commandAllowlist: '',
  // Off by default. Turning this on is an explicit trust decision: Build may
  // write and run allowlisted commands without an Allow / Deny card. Plan mode
  // never reaches this path, and the workspace/allowlist checks still apply.
  autoApprove: false,
  // Reading another saved chat is a separate permission: it exposes a
  // conversation the user never pasted into this one, so it stays off until
  // they ask for it. The server enforces it in both Plan and Build.
  crossChat: false,
};

let catalog = { models: [], fetchedAt: 0 };
let htmlCache = null;
// One loopback preview server, pinned to the chat that opened it. Opening a
// preview in another chat closes the old server first, so its token and
// workspace cannot be reused by the next chat.
let previewServer = null;
let previewOwner = '';

function previewKey(chatId, requested) {
  return `${chatId || 'legacy'}:${requested === undefined ? 'legacy' : requested || 'managed'}`;
}

function localPreviewServer(chatId, requested) {
  const key = previewKey(chatId, requested);
  if (previewServer && previewOwner === key) return previewServer;
  void previewServer?.close();
  previewServer = createPreviewServer({
    getWorkspace: () => workspaceFor(chatId, requested),
    appPort: PORT,
  });
  previewOwner = key;
  return previewServer;
}

function closePreviewServer(chatId = null) {
  if (!previewServer) return;
  if (chatId && !previewOwner.startsWith(`${chatId}:`)) return;
  const closing = previewServer;
  previewServer = null;
  previewOwner = '';
  void closing.close();
}

/** The page a write produced, when that page can be served on its own. */
function previewPageFrom(outcome, name, input) {
  if (!outcome?.ok) return '';
  const candidate =
    name === 'scaffold_project'
      ? outcome.path
      : name === 'write_file' || name === 'apply_patch'
        ? input?.path
        : '';
  return typeof candidate === 'string' && /\.(html?|svg)$/i.test(candidate) ? candidate : '';
}

/**
 * Open one workspace page on the loopback preview server and return the exact
 * URL. Models cannot open a browser, so this tool is how they hand the user a
 * link they can click without having to find the Preview panel first.
 */
async function previewLinkFor(entry, chatId = null, requested = undefined) {
  const sandbox = workspaceFor(chatId, requested);
  if (!sandbox.isReady) {
    return {
      ok: false,
      content: 'Error: No workspace folder is set. Ask the user to choose one in Settings.',
    };
  }
  const wanted = String(entry ?? '').trim() || sandbox.findPreviewEntry() || '';
  if (!wanted) {
    return {
      ok: false,
      content: 'Error: No HTML or SVG page is available to preview. Write one first.',
    };
  }
  if (!/\.(html?|svg)$/i.test(wanted)) {
    return {
      ok: false,
      content:
        `Error: /${wanted} is not an HTML or SVG page, so it cannot be served on its own. ` +
        'Markdown opens inside the Preview panel instead.',
    };
  }
  try {
    const file = sandbox.readAsset(wanted);
    // Pinned to this chat, like the Preview panel: a link from another chat is
    // not allowed to keep serving its files after a switch.
    const preview = localPreviewServer(chatId, requested);
    const served = await preview.open(file.path, { host: '127.0.0.1' });
    return {
      ok: true,
      entry: served.entry,
      url: served.url,
      content:
        `Preview link for /${served.entry}:\n${served.url}\n\n` +
        'Give this exact link to the user. It opens the page in a new tab on this computer while Freeway is running; the Preview panel also shows it.',
    };
  } catch (error) {
    return { ok: false, content: `Error: ${String(error?.message ?? error)}` };
  }
}

/**
 * Models that already failed in this session. Remembering them for the rest of
 * the session stops every new turn from walking into the same 429 again. They
 * are forgotten on New Chat, and if every model is cooling down the map is
 * cleared rather than leaving the app with nothing to send.
 */
const cooling = new Map();

function coolDown(model, reason, retryAfterMs = null) {
  if (!model) return;
  const now = Date.now();
  const fallback = reason === 'rate-limit' ? 60_000 : 30_000;
  const wait = Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : fallback;
  cooling.set(model, { at: now, until: now + Math.min(wait, 15 * 60_000), reason });
}

function coolingIds() {
  return [...cooling.keys()];
}

function resetCooling() {
  cooling.clear();
}

// One bounded, in-memory record of what this run tried. The Status tab reads it;
// nothing is persisted, so it can never leak usage history to disk.
const statusLog = createStatusLog();

/* ---------------------------------------------------------------- config */

function defaultConfigDir() {
  const base =
    process.platform === 'win32'
      ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const current = path.join(base, 'Freeway');
  // Pre-2.0 data folder; keep the old name for settings migration.
  const legacy = path.join(base, 'OpenRouterChat');
  // 1.x wrote under the old product name; carry that data forward once.
  if (!fs.existsSync(current) && fs.existsSync(legacy)) {
    try {
      fs.cpSync(legacy, current, { recursive: true });
    } catch {
      return legacy;
    }
  }
  return current;
}

/**
 * Where the key, settings and chats live. A file path in --config is taken as
 * the config file itself; a folder is taken as the place to put config.json.
 */
export function resolveConfigLocation(flagPath) {
  const asFile = (value) => {
    const file = path.resolve(value);
    return { file, dir: path.dirname(file) };
  };

  if (flagPath) {
    const resolved = path.resolve(flagPath);
    let isFile = /\.json$/i.test(resolved);
    try {
      if (!isFile && fs.existsSync(resolved)) isFile = fs.statSync(resolved).isFile();
    } catch {
      /* treat it as a folder */
    }
    return isFile ? asFile(resolved) : { dir: resolved, file: path.join(resolved, 'config.json') };
  }

  const dirEnv = (process.env.OPENROUTER_LOCAL_CONFIG_DIR || '').trim();
  if (dirEnv) {
    const dir = path.resolve(dirEnv);
    return { dir, file: path.join(dir, 'config.json') };
  }

  const fileEnv = (process.env.OPENROUTER_CONFIG || '').trim();
  if (fileEnv) return asFile(fileEnv);

  const dir = defaultConfigDir();
  return { dir, file: path.join(dir, 'config.json') };
}

export function configLocation() {
  return resolveConfigLocation(cli.config);
}

export function configPath() {
  return configLocation().file;
}

let threadStore = null;

function store() {
  threadStore ??= openStore(path.join(configLocation().dir, 'threads.json'));
  return threadStore;
}

let secretsStore = null;

function secrets() {
  secretsStore ??= openSecrets(path.join(configLocation().dir, 'secrets.json'));
  return secretsStore;
}

const CHAT_ID = /^[A-Za-z0-9_-]{6,64}$/;

function workspace() {
  return createWorkspace(loadConfig().workspace ?? '');
}

// A new chat gets its own folder under the app config, created lazily on the
// first file operation. Existing chats have no workspace field and keep using
// the old Settings folder, so upgrading does not hide a project.
function managedWorkspace(chatId) {
  if (!CHAT_ID.test(String(chatId ?? ''))) {
    throw Object.assign(new Error('Missing or invalid chat id.'), { status: 400 });
  }
  const dir = path.join(configLocation().dir, 'workspaces', chatId);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return createWorkspace(dir);
}

/**
 * Resolve the workspace for one turn or file request.
 *
 * `requested` is the page's workspacePath: undefined means older chats use the
 * global Settings folder, an empty string means the app-managed chat folder,
 * and any other string is an explicit project folder. The thread field is the
 * authority for page-driven requests; this fallback keeps old API clients and
 * the existing CLI/simulation tests on the legacy folder.
 */
function workspaceFor(chatId, requested) {
  if (typeof requested === 'string' && requested.trim()) return createWorkspace(requested);
  if (requested === '') return managedWorkspace(chatId);
  const id = typeof chatId === 'string' && CHAT_ID.test(chatId) ? chatId : null;
  const thread = id ? store().get(id) : null;
  if (thread && Object.prototype.hasOwnProperty.call(thread, 'workspace')) {
    if (thread.workspace) return createWorkspace(thread.workspace);
    return managedWorkspace(id);
  }
  return workspace();
}

// The GitHub token lives in the secrets store, never in the config file and
// never in the page.
function github() {
  return createGithub(secrets().get('GITHUB_TOKEN') ?? '');
}

// Rebuilt per call so a settings change applies to the next command. With the
// checkbox off the allowlist is empty, and an empty allowlist refuses everything.
function commandRunner(root = loadConfig().workspace ?? '') {
  const settings = loadSettings();
  return createCommandRunner({
    root,
    allowlist: settings.allowCommands ? parseAllowlist(settings.commandAllowlist) : [],
  });
}

// One manager for the whole run: a dev server outlives the turn that started
// it, so the next turn and the Preview panel can still reach it.
const processManager = createProcessManager({
  getRunner: (root) => commandRunner(root || loadConfig().workspace || ''),
  excludePorts: [PORT],
});

// One interactive browser at a time. It is a local tool session, not a user
// browser: it receives no app secrets, opens only the loopback preview, and is
// closed when the app exits or after two idle minutes.
const browserManager = createBrowserManager();

// File checkpoints are in memory and bounded. They are keyed by the chat's
// workspace owner, so undo can never restore a file in another chat.
const checkpointStore = createCheckpointStore();

// Closing the window must not leave a dev server or headless browser running.
process.on('exit', () => {
  browserManager.closeSync();
  processManager.stopAllSync();
});

// Model-initiated writes park here until the page says yes or no.
const pendingConfirms = new Map();

function requestConfirm(res, name, args, signal, extra = {}) {
  return new Promise((resolve) => {
    const id = randomUUID();
    const settle = (allow) => {
      const entry = pendingConfirms.get(id);
      if (!entry) return;
      pendingConfirms.delete(id);
      clearTimeout(entry.timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(allow);
    };
    const onAbort = () => settle(false);
    // A page that never answers is a no: silence must not mean consent.
    const timer = setTimeout(() => settle(false), 180_000);
    pendingConfirms.set(id, { settle, timer });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted || res.writableEnded) {
      settle(false);
      return;
    }
    sseSend(res, {
      type: 'confirm',
      id,
      name,
      arguments: typeof args === 'string' ? args : JSON.stringify(args),
      ...extra,
    });
  });
}

async function runToolConfirmed(res, name, args, ctx, signal) {
  // Plan mode is enforced here, not only by the advertised tool list: a model
  // can still emit a mutating call, and it must be refused before any
  // confirmation card or workspace write.
  if (ctx.planMode && !PLAN_TOOL_NAMES.has(name)) {
    return {
      ok: false,
      content: `Error: Plan mode is read-only. \`${name}\` is not available until the user presses Build.`,
    };
  }
  // A provider can emit a call for a tool that was never advertised. Reading
  // another chat is a permission, not a capability, so it is refused here as
  // well, before any confirmation card or read.
  if (CROSS_CHAT_TOOL_NAMES.has(name) && !crossChatEnabled(loadSettings())) {
    return {
      ok: false,
      content:
        'Error: reading other saved chats is off in Settings. Answer without them, or ask the user to turn on "Let the assistant read my other saved chats".',
    };
  }
  // A stopped or disconnected turn must not start a new action, even when the
  // user has auto-approved Build. The confirmation path otherwise supplies this
  // check through its abort listener.
  if (signal?.aborted) {
    return { ok: false, content: 'Error: the turn was stopped before this action ran.' };
  }
  // Auto-approval is a separate, explicit opt-in. It is checked after the
  // Plan guard above, so Plan can never inherit it, and every tool still runs
  // through its normal workspace and command-allowlist checks.
  const autoApprove = !ctx.planMode && loadSettings().autoApprove === true;
  const approve = (extra = {}) => {
    if (!autoApprove) return requestConfirm(res, name, args, signal, extra);
    sseSend(res, {
      type: 'auto_approve',
      name,
      arguments: JSON.stringify(args),
      ...extra,
    });
    return true;
  };
  let checkpoint = null;
  const capture = (paths) => {
    if (!ctx.checkpoints) return;
    checkpoint = ctx.checkpoints.prepare(ctx.workspace, paths, {
      owner: ctx.checkpointOwner,
      tool: name,
    });
  };
  if (name === 'apply_patch') {
    // Build the real diff before asking, so the card shows exactly what will
    // change. previewPatch validates every find and never writes anything.
    let preview;
    try {
      if (!ctx.workspace?.isReady) {
        return { ok: false, content: 'Error: No workspace folder is set. Ask the user to choose one in Settings.' };
      }
      preview = ctx.workspace.previewPatch(args);
    } catch (error) {
      return { ok: false, content: `Error: ${error?.message ?? error}` };
    }
    const allowed = await approve({
      path: preview.path,
      diff: preview.diff,
    });
    if (!allowed) {
      return { ok: false, content: 'The user declined this patch. Do not retry it without asking first.' };
    }
    try {
      capture([preview.path]);
    } catch (error) {
      return { ok: false, content: `Error: could not create a checkpoint for this patch: ${error?.message ?? error}` };
    }
  } else if (name === 'scaffold_project') {
    let layout;
    try {
      layout = scaffoldLayout(args);
    } catch (error) {
      return { ok: false, content: `Error: ${error?.message ?? error}` };
    }
    const allowed = await approve({
      path: layout.entry,
      files: layout.paths,
    });
    if (!allowed) {
      return { ok: false, content: 'The user declined this scaffold. Do not retry it without asking first.' };
    }
    try {
      capture(layout.paths);
    } catch (error) {
      return { ok: false, content: `Error: could not create a checkpoint for this scaffold: ${error?.message ?? error}` };
    }
  } else if (name === 'start_process' || name === 'stop_process') {
    const allowed = await approve();
    if (!allowed) {
      return { ok: false, content: 'The user declined this process action. Do not retry it without asking first.' };
    }
  } else if (name === 'run_check') {
    let check;
    try {
      check = resolveCheck(ctx.workspace, args);
    } catch (error) {
      return { ok: false, content: `Error: ${error?.message ?? error}` };
    }
    const allowed = await approve({
      kind: check.kind,
      program: check.program,
      args: check.args,
      cwd: check.cwd,
      script: check.script,
      scriptBody: check.scriptBody,
    });
    if (!allowed) {
      return { ok: false, content: 'The user declined this check. Do not retry it without asking first.' };
    }
  } else if (
    name === 'write_file' ||
    name === 'render_chart' ||
    name === 'notify' ||
    name === 'post_url' ||
    name === 'github_create_issue' ||
    name === 'github_update_issue' ||
    name === 'github_comment' ||
    name === 'github_create_pull' ||
    name === 'github_review_pull' ||
    name === 'github_merge_pull' ||
    name === 'github_actions' ||
    name === 'github_create_release' ||
    name === 'github_create_repo' ||
    name === 'github_pull' ||
    name === 'github_push' ||
    name === 'github_branch' ||
    name === 'github_clone' ||
    name === 'run_command' ||
    name === 'run_tests' ||
    name === 'git_commit' ||
    name === 'git_revert' ||
    name === 'browser_open' ||
    name === 'browser_click' ||
    name === 'browser_type'
  ) {
    const allowed = await approve();
    if (!allowed) {
      return { ok: false, content: 'The user declined this write. Do not retry it without asking first.' };
    }
    if (name === 'write_file') {
      try {
        capture([args?.path]);
      } catch (error) {
        return { ok: false, content: `Error: could not create a checkpoint for this write: ${error?.message ?? error}` };
      }
    }
  }
  const outcome = await runTool(name, args, ctx);
  if (checkpoint && outcome.ok) {
    try {
      return { ...outcome, checkpoint: ctx.checkpoints.commit(checkpoint) };
    } catch (error) {
      // The write succeeded, so do not turn it into a failure; tell the user
      // that this particular change cannot be undone.
      return { ...outcome, checkpointError: String(error?.message ?? error) };
    }
  }
  return outcome;
}

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveConfig(patch) {
  const target = configPath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const next = { ...loadConfig(), ...patch };
  fs.writeFileSync(target, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  // `mode` only applies when the file is created. An older config may already
  // be 0644, so tighten it on every save without failing on platforms that
  // cannot represent Unix modes.
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    /* Windows and restricted filesystems may ignore the mode */
  }
  return next;
}

function apiKey() {
  return process.env.OPENROUTER_API_KEY || loadConfig().apiKey || '';
}

/** The provider saved in config, or OpenRouter for older installs. */
function activeProvider() {
  return getProvider(loadConfig().provider) ?? getProvider('openrouter');
}

function providerKey(provider) {
  // A local daemon has no key; "local" keeps it usable without pretending a
  // secret exists or showing the paste-a-key screen.
  if (provider.local) return 'local';
  // A public endpoint needs no secret either; the sentinel keeps it usable
  // without pretending one exists.
  if (provider.anonymous) return 'anonymous';
  return keyFor(provider, loadConfig(), process.env);
}

/** Is the local daemon answering? A missing one must not look like a bad key. */
const localProbes = new Map();
async function localProviderUp(provider) {
  const cached = localProbes.get(provider.id);
  if (cached && Date.now() - cached.at < 5000) return cached.up;
  let up = false;
  try {
    const response = await fetch(modelsUrl(provider), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(800),
    });
    up = response.ok;
  } catch {
    up = false;
  }
  localProbes.set(provider.id, { at: Date.now(), up });
  return up;
}

/** One cached model list per provider, dropped when the key changes. */
const providerCatalogs = new Map();

async function fetchProviderIds(provider, key, config = loadConfig()) {
  const response = await fetch(modelsUrl(provider, process.env, config), {
    headers: headersFor(provider, key),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.ok) {
    const body = await response.json().catch(() => ({}));
    const ids = (Array.isArray(body?.data) ? body.data : [])
      .map((model) => model?.id)
      .filter((id) => typeof id === 'string' && id);
    if (ids.length > 0) return ids;
  }

  // A rejected key is not "this provider hides its model list": the fallback
  // list must not make a bad key look like a working provider.
  if (response.status === 401 || response.status === 403) {
    throw Object.assign(new Error(`${provider.label} rejected the saved key.`), {
      status: 401,
      responseStatus: response.status,
    });
  }

  // Gemini's OpenAI compatibility layer does not always expose /models; its
  // native endpoint does, and it also tells us which models can chat.
  if (provider.nativeBase) {
    const native = await fetch(`${provider.nativeBase}/models?key=${encodeURIComponent(key)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (native.ok) {
      const body = await native.json().catch(() => ({}));
      return (Array.isArray(body?.models) ? body.models : [])
        .filter((model) => (model?.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((model) => String(model?.name ?? '').replace(/^models\//, ''))
        .filter(Boolean);
    }
  }

  throw Object.assign(new Error(`${provider.label} model list unavailable (HTTP ${response.status})`), {
    status: 502,
    responseStatus: response.status,
  });
}

/**
 * Model rows for any provider. OpenRouter keeps its priced catalog; the others
 * are filtered by the allow/deny rules that stand in for pricing.
 */
async function getProviderModels(provider, force = false, config = loadConfig()) {
  if (provider.id === 'openrouter') return getCatalog(force);

  const key = providerKey(provider);
  const cached = providerCatalogs.get(provider.id);
  const fresh = cached && cached.keyTail === keyTail(key) && Date.now() - cached.at < CATALOG_TTL_MS;
  if (!force && fresh) return cached.rows;

  let ids = [];
  try {
    ids = await fetchProviderIds(provider, key, config);
  } catch (error) {
    // A rejected key must surface as such, not as a fallback model list.
    if (error.status === 401) throw error;
    // Some compatibility layers do not expose /models (Cohere's, for one). A
    // short known-good list keeps the provider usable instead of dead.
    if (!provider.fallbackModels?.length) throw error;
    ids = provider.fallbackModels;
  }
  if (ids.length === 0 && provider.fallbackModels?.length) ids = provider.fallbackModels;

  const rows = ids
    .filter((id) => isAllowedModel(provider, id))
    .map((id) => toModelRow(provider, id))
    .sort((a, b) => a.id.localeCompare(b.id));

  providerCatalogs.set(provider.id, { at: Date.now(), keyTail: keyTail(key), rows });
  return rows;
}

/** Clamp anything the settings screen sends; never trust the browser blindly. */
function sanitizeSettings(input = {}) {
  const next = {};
  if (typeof input.systemPrompt === 'string') next.systemPrompt = input.systemPrompt.slice(0, 4000);
  if (input.temperature === null) next.temperature = null;
  else if (typeof input.temperature === 'number' && Number.isFinite(input.temperature)) {
    next.temperature = Math.min(Math.max(input.temperature, 0), 2);
  }
  if (typeof input.maxTokens === 'number' && Number.isFinite(input.maxTokens)) {
    next.maxTokens = Math.min(Math.max(Math.round(input.maxTokens), 256), 4000);
  }
  if (typeof input.tools === 'boolean') next.tools = input.tools;
  if (typeof input.showLog === 'boolean') next.showLog = input.showLog;
  if (typeof input.screenshotChecks === 'boolean') next.screenshotChecks = input.screenshotChecks;
  if (typeof input.allowCommands === 'boolean') next.allowCommands = input.allowCommands;
  if (typeof input.commandAllowlist === 'string') {
    next.commandAllowlist = input.commandAllowlist.slice(0, 300);
  }
  if (typeof input.autoApprove === 'boolean') next.autoApprove = input.autoApprove;
  if (typeof input.crossChat === 'boolean') next.crossChat = input.crossChat;
  if (typeof input.requestCap === 'number' && Number.isFinite(input.requestCap)) {
    next.requestCap = Math.min(Math.max(Math.round(input.requestCap), 0), 1000);
  }
  return next;
}

function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...sanitizeSettings(loadConfig().settings ?? {}) };
}

/* ------------------------------------------------------------ http utils */

// No CDNs and no external scripts: the page only talks to itself. The single
// exception is frame-src, because the preview panel loads a local dev server
// inside an iframe. Nothing may frame *this* app (frame-ancestors 'none').
const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src http: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

function sendJson(res, status, body) {
  let data = Buffer.from(JSON.stringify(body), 'utf8');
  // The model catalog is ~80 KB of JSON. Over a slow tunnel that is ten seconds
  // of "stuck at loading" while the page boots, so anything worth sending gets
  // compressed when the client asked for it.
  const compress = res.wantsGzip === true && data.length > 1024;
  if (compress) data = gzipSync(data);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...(compress ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
    'content-length': data.length,
  });
  res.end(data);
}

function readJson(req, limit = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        settled = true;
        chunks.length = 0;
        // Keep draining instead of destroying the socket, so the 413 can be
        // delivered and the memory is released either way.
        reject(
          Object.assign(new Error(`Request body too large (limit ${limit} bytes)`), { status: 413 }),
        );
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (chunks.length === 0) return resolve({});
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // JSON null and primitives are valid JSON but cannot carry a route
        // object; treating them as an empty body would turn a bad request into
        // an uncaught property access (500).
        if (parsed === null || typeof parsed !== 'object') {
          reject(Object.assign(new Error('JSON body must be an object'), { status: 400 }));
          return;
        }
        resolve(parsed);
      } catch (error) {
        if (error?.status === 400) {
          reject(error);
          return;
        }
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });

    req.on('error', (error) => {
      if (!settled) reject(error);
    });
  });
}

async function pageHtml() {
  if (htmlCache) return htmlCache;
  try {
    const sea = await import('node:sea');
    if (typeof sea.isSea === 'function' && sea.isSea()) {
      htmlCache = sea.getAsset('public/index.html', 'utf8');
      return htmlCache;
    }
  } catch {
    /* not a single-executable build */
  }
  htmlCache = fs.readFileSync(path.join(import.meta.dirname, 'public', 'index.html'), 'utf8');
  return htmlCache;
}


let iconCache = null;

async function iconSvg() {
  if (iconCache) return iconCache;
  try {
    const sea = await import('node:sea');
    if (typeof sea.isSea === 'function' && sea.isSea()) {
      iconCache = Buffer.from(sea.getAsset('public/icon.svg'));
      return iconCache;
    }
  } catch {
    /* not a single-executable build */
  }
  iconCache = fs.readFileSync(path.join(import.meta.dirname, 'public', 'icon.svg'));
  return iconCache;
}

/* ----------------------------------------------------------- openrouter */

async function getCatalog(force = false) {
  const fresh = catalog.models.length > 0 && Date.now() - catalog.fetchedAt < CATALOG_TTL_MS;
  if (!force && fresh) return catalog.models;

  const key = apiKey();
  const response = await fetch(`${BASE_URL}/models?output_modalities=text&sort=most-popular`, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw Object.assign(new Error(`Model catalog unavailable (HTTP ${response.status})`), { status: 502 });
  }
  const body = await response.json();
  const models = Array.isArray(body?.data) ? body.data : [];
  if (models.length === 0) {
    throw Object.assign(new Error('Model catalog came back empty'), { status: 502 });
  }
  catalog = { models, fetchedAt: Date.now() };
  return models;
}

async function getKeyInfo() {
  const key = apiKey();
  if (!key) return { ok: false, reason: 'missing-key' };
  try {
    const response = await fetch(`${BASE_URL}/key`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        // An upstream error can quote the key it rejected. This response is
        // shown in the page, so scrub it before it leaves the process.
        message: scrubSecrets(String(body?.error?.message ?? `HTTP ${response.status}`)).slice(0, 300),
      };
    }
    const data = body?.data ?? {};
    return {
      ok: true,
      isFreeTier: Boolean(data.is_free_tier),
      usage: data.usage ?? 0,
      limitRemaining: data.limit_remaining ?? null,
      freeDaily: data.free_model_daily_requests ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'network',
      message: scrubSecrets(String(error?.message ?? error)).slice(0, 300),
    };
  }
}

/* ---------------------------------------------------------------- chat */

function sanitizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw Object.assign(new Error('A non-empty messages array is required'), { status: 400 });
  }
  let total = 0;
  const messages = [];
  for (const raw of input.slice(-40)) {
    const role = raw?.role;
    const content = typeof raw?.content === 'string' ? raw.content : '';
    if (!['system', 'user', 'assistant'].includes(role) || content.length === 0) continue;
    const images = role === 'user' ? cleanImages(raw?.images) : [];
    total += content.length;
    messages.push({ role, content, ...(images.length ? { images } : {}) });
  }
  if (messages.length === 0) {
    throw Object.assign(new Error('No usable messages were provided'), { status: 400 });
  }
  if (total > MAX_INPUT_CHARS) {
    throw Object.assign(new Error(`Conversation is too long (${total} chars, limit ${MAX_INPUT_CHARS})`), {
      status: 413,
    });
  }
  return messages;
}

function sseSend(res, payload) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function classifyFailure(status, body, headers = null) {
  const metadata = body?.error?.metadata ?? {};
  const limitSource = metadata.limit_source ?? null;
  const message = body?.error?.message ?? `HTTP ${status}`;
  const retryAfter = Number(headers?.get?.('retry-after'));
  const retryAfterMs =
    Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 15 * 60_000) : null;
  if (status === 402) {
    return { retry: limitSource === 'openrouter_in_flight_budget', reason: 'credit', message, limitSource, retryAfterMs };
  }
  if (status === 429) return { retry: true, reason: 'rate-limit', message, limitSource, retryAfterMs };
  if (status >= 500) return { retry: true, reason: 'upstream', message, limitSource, retryAfterMs };
  return { retry: false, reason: 'request', message, limitSource, retryAfterMs };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

/** Merge OpenAI-style streaming tool_calls, which arrive split across chunks. */
function collectToolCalls(delta, state) {
  if (!Array.isArray(delta?.tool_calls)) return;
  for (const call of delta.tool_calls) {
    const index = Number.isInteger(call?.index) ? call.index : state.toolCalls.length;
    const slot = (state.toolCalls[index] ??= {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    });
    if (call.id) slot.id = call.id;
    if (call.function?.name) slot.function.name += call.function.name;
    if (call.function?.arguments) slot.function.arguments += call.function.arguments;
  }
}

async function forwardStream(upstream, res, state) {
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event?.error) {
          state.error = event.error;
          continue;
        }
        if (typeof event?.model === 'string' && event.model !== state.model) {
          state.model = event.model;
          sseSend(res, { type: 'model', model: state.model });
        }

        const delta = event?.choices?.[0]?.delta;
        collectToolCalls(delta, state);

        const text = delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          state.text += text;
          sseSend(res, { type: 'delta', text });
        }
        if (event?.usage) state.usage = event.usage;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

async function handleChat(req, res) {
  const body = await readJson(req, CHAT_BODY_LIMIT);
  const config = loadConfig();
  // An unknown provider used to fall back to OpenRouter silently, which sent a
  // Groq/Gemini conversation to a different service than the page showed.
  const requestedProvider =
    typeof body.provider === 'string' && body.provider.trim()
      ? body.provider.trim()
      : loadConfig().provider;
  // No provider at all (an older page, a script, a fresh install) means
  // OpenRouter; a provider that is named but unknown is an error.
  const provider = getProvider(requestedProvider || 'openrouter');
  if (!provider) {
    return sendJson(res, 400, {
      error: `Unknown provider "${requestedProvider}".`,
      provider: String(requestedProvider ?? ''),
    });
  }
  const key = providerKey(provider);
  if (!key) {
    return sendJson(res, 400, {
      error: `No ${provider.label} key saved yet. Choose that provider and paste a key.`,
      provider: provider.id,
    });
  }
  if (provider.requiresAccount && !accountFor(provider, config, process.env)) {
    return sendJson(res, 400, {
      error: `No ${provider.label} Account ID saved yet. Add it with the API token.`,
      provider: provider.id,
      needsAccount: true,
    });
  }

  let messages = sanitizeMessages(body.messages);
  const pictures = messages.some((message) => cleanImages(message.images).length > 0);
  if (pictures && provider.id !== 'openrouter') {
    return sendJson(res, 400, {
      error: 'Image attachments need an OpenRouter free vision model. Switch provider or remove the image.',
      provider: provider.id,
    });
  }
  // Older turns become one system note before the request leaves this process;
  // the saved thread and the page still hold the full history.
  const memory = compactMessages(messages);
  messages = memory.messages;
  // Where to keep a partial answer if this connection dies mid-stream.
  const draftId =
    typeof body.threadId === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(body.threadId) ? body.threadId : null;
  const requestedWorkspace =
    body.workspace === null || typeof body.workspace === 'string' ? body.workspace : undefined;
  // Tools and commands for this turn must see the same chat folder as the
  // Files and Preview panels. The page sends workspacePath with every turn;
  // an older client sends nothing and keeps the legacy Settings folder.
  const turnWorkspace = workspaceFor(draftId, requestedWorkspace);
  const settings = loadSettings();
  // Plan is a property of this request, not a page-only hint: the server
  // removes every mutating tool and runToolConfirmed refuses one if a model
  // calls it anyway.
  const mode = body.mode === 'plan' ? 'plan' : 'build';
  const planMode = mode === 'plan';
  const roundLimit = planMode ? PLAN_TOOL_ROUNDS : MAX_TOOL_ROUNDS;
  const requested = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
  const estimate = estimateTokens(messages);

  let models = [];
  try {
    models = await getProviderModels(provider, false, config);
  } catch (error) {
    // A rejected key is the user's problem and has to surface as one.
    if (error.status === 401) throw error;
    // Keep whatever the last good fetch returned: a transient upstream failure
    // must not turn an unchecked model id into an apparently safe one.
    models = provider.id === 'openrouter' ? catalog.models : [];
  }

  let chain = [];
  if (provider.id === 'openrouter') {
    if (models.length > 0) {
      const avoid = coolingIds();
      chain = buildChain(models, {
        primary: requested,
        minContext: estimate + 256,
        // OpenRouter rejects a `models` array longer than three, so the chain
        // itself never exceeds three candidates.
        limit: 3,
        exclude: avoid,
        needVision: pictures,
      });
      // Everything is cooling down, so the memory is stale — forget it instead of
      // refusing to answer.
      if (chain.length === 0 && avoid.length > 0) {
        resetCooling();
        chain = buildChain(models, { primary: requested, minContext: estimate + 256, limit: 3, needVision: pictures });
      }
    } else {
      // No catalog has ever loaded, so no id can be checked against live
      // pricing. Refuse instead of sending a model that might bill the account.
      return sendJson(res, 502, {
        error:
          'The OpenRouter model catalog is unavailable, so free-only pricing cannot be verified. Try again in a moment.',
        provider: provider.id,
      });
    }
  } else {
    // These providers have no pricing catalog and no `models` fallback array:
    // one model per turn, and it has to pass the provider's free-tier rule.
    const listed = models.map((model) => model.id);
    const pick = requested && isAllowedModel(provider, requested) ? requested : listed[0] ?? null;
    chain = pick && isAllowedModel(provider, pick) ? [pick] : [];
  }

  if (chain.length === 0) {
    return sendJson(res, 400, {
      error: pictures
        ? 'No free vision model can handle this image. Pick another image, or ask a text-only question without it.'
        : provider.id === 'openrouter'
          ? 'No suitable free model is available for this conversation.'
          : `No ${provider.label} model passed its free-tier rule. Open the model list and pick one.`,
      provider: provider.id,
    });
  }

  // The selected provider is the whole provider decision. Retry another free
  // model inside it if needed, but never move the turn to another service.
  const steps = chain.map((id) => ({ provider, key, model: id }));

  // Tools are attached only when the leading model supports them. The model
  // chain stays complete, so a busy model still retries exactly as before.
  const leading = models.find((model) => model.id === chain[0]);
  // OpenRouter publishes per-model capabilities. The other providers do not, so
  // tools are offered and the existing 400-without-tools retry covers a model
  // that turns out not to support them.
  const toolsSupported = provider.id === 'openrouter' ? Boolean(leading && supportsParam(leading, 'tools')) : true;
  let tools = [];
  if (planMode) {
    // Planning cannot happen without these, so Plan mode keeps them even when
    // the general tool switch is off. Every one reads or describes; Build still
    // honours the switch.
    tools = TOOL_DEFINITIONS.filter((tool) => PLAN_TOOL_NAMES.has(tool.function.name));
  } else if (settings.tools && toolsSupported) {
    tools = TOOL_DEFINITIONS;
  }
  // Reading other chats is its own opt-in, in Plan and Build alike: without the
  // setting the tools are never advertised, so a model cannot learn they exist.
  if (!crossChatEnabled(settings)) {
    tools = tools.filter((tool) => !CROSS_CHAT_TOOL_NAMES.has(tool.function.name));
  }
  // Do not advertise command tools unless they could actually work: a workspace
  // folder, the checkbox, and at least one program on the allowlist. run_tests
  // uses the same runner as run_command, so it must disappear under the same
  // conditions instead of offering a call that can only fail.
  const runner = commandRunner(turnWorkspace.root ?? '');
  if (tools.length > 0 && !runner.isReady) {
    tools = tools.filter(
      (tool) =>
        tool.function.name !== 'run_command' &&
        tool.function.name !== 'run_tests' &&
        tool.function.name !== 'start_process',
    );
  }

  // A screenshot is only useful when every model in the fallback chain can see
  // it. Otherwise a retry could receive an image it cannot understand. The
  // pure helper also enforces the switch, Plan mode and the workspace.
  const screenshotReady = screenshotAllowed({
    mode,
    enabled: settings.screenshotChecks !== false,
    toolsOffered: tools.length > 0,
    toolsSupported,
    workspaceReady: turnWorkspace.isReady,
    providerId: provider.id,
    chain,
    models,
  });
  if (tools.length > 0 && !screenshotReady) {
    tools = tools.filter(
      (tool) =>
        tool.function.name !== 'screenshot_preview' &&
        tool.function.name !== 'browser_screenshot',
    );
  }
  // Browser sessions need a preview page from a workspace. Offering them with
  // no workspace would only produce calls that must fail.
  if (tools.length > 0 && !turnWorkspace.isReady) {
    tools = tools.filter((tool) => !tool.function.name.startsWith('browser_'));
  }
  // The browser loop uses Node's built-in WebSocket. On Node 20 that global is
  // behind a flag; hide the tools instead of offering a guaranteed failure.
  if (tools.length > 0 && typeof WebSocket !== 'function') {
    tools = tools.filter((tool) => !tool.function.name.startsWith('browser_'));
  }

  let screenshotsTaken = 0;
  const capturePreview = screenshotReady
    ? async (input = {}) => {
        if (screenshotsTaken >= MAX_SCREENSHOTS) {
          return {
            ok: false,
            content: `Screenshot FAILED: at most ${MAX_SCREENSHOTS} captures are allowed in one Build run. Use preview_check or fix the page directly.`,
          };
        }
        const entry =
          typeof input.entry === 'string' && input.entry.trim() ? input.entry.trim() : 'index.html';
        // A temporary server keeps the user's Preview panel and its token
        // untouched, then closes as soon as the capture finishes.
        const preview = createPreviewServer({ getWorkspace: () => turnWorkspace, appPort: PORT });
        try {
          const opened = await preview.open(entry);
          const viewport = screenshotViewport(input.viewport);
          const shot = await captureScreenshot({
            url: opened.url,
            width: viewport.width,
            height: viewport.height,
          });
          screenshotsTaken += 1;
          return {
            ...shot,
            ok: true,
            entry,
            viewport: input.viewport ?? 'desktop',
            content:
              `Captured /${entry} at ${shot.width}×${shot.height} (${Math.round(shot.bytes / 1024)} KB). ` +
              'The image is attached to the conversation so you can inspect layout, spacing, overflow and contrast.',
          };
        } catch (error) {
          return { ok: false, content: `Screenshot FAILED: ${String(error?.message ?? error)}` };
        } finally {
          await preview.close().catch(() => {});
        }
      }
    : undefined;

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const controller = new AbortController();
  let clientGone = false;
  req.on('close', () => controller.abort());
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
    // The interactive browser is a per-turn tool session. Closing it here
    // avoids leaving one chat's preview readable by the next chat and frees a
    // headless process when the answer finishes or the tab disappears.
    void browserManager.close();
  });

  // One cross-chat budget for this request: a few lookups, never the library.
  let crossChatLookups = 0;
  const takeChatLookup = () => {
    crossChatLookups += 1;
    return crossChatLookups <= CROSS_CHAT_TURN_LIMIT;
  };
  const chatLibrary = {
    list: (input = {}) =>
      takeChatLookup()
        ? formatChatList(store().list(String(input.query ?? '')), {
            currentId: draftId,
            limit: input.limit,
          })
        : {
            ok: false,
            content: `Error: the ${CROSS_CHAT_TURN_LIMIT}-lookup limit for this turn is used up. Answer with what you have.`,
          },
    read: (input = {}) =>
      takeChatLookup()
        ? formatChatTranscript(store().get(String(input.id ?? '')), {
            currentId: draftId,
            query: input.query,
            maxMessages: input.maxMessages,
          })
        : {
            ok: false,
            content: `Error: the ${CROSS_CHAT_TURN_LIMIT}-lookup limit for this turn is used up. Answer with what you have.`,
          },
  };
  const conversation = [];
  if (settings.systemPrompt.trim()) conversation.push({ role: 'system', content: settings.systemPrompt.trim() });
  conversation.push(...messages.map(toUpstreamMessage));

  sseSend(res, {
    type: 'meta',
    mode,
    provider: provider.id,
    chain,
    fallbacks: steps.filter((step) => step.provider.id !== provider.id).map((step) => step.provider.label),
    skipped: coolingIds(),
    tools: tools.map((tool) => tool.function.name),
    screenshots: screenshotReady,
    rounds: roundLimit,
    repair: mode === 'build' ? { maxAttempts: REPAIR_MAX_ATTEMPTS } : null,
    build: mode === 'build' ? { maxSteps: MAX_BUILD_STEPS, maxMs: MAX_BUILD_MS } : null,
    memory: memory.compacted
      ? {
          compacted: memory.compacted,
          beforeTokens: memory.beforeTokens,
          afterTokens: memory.afterTokens,
        }
      : null,
  });

  const post = (target, payload) =>
    fetch(chatUrl(target.provider, process.env, config), {
      method: 'POST',
      headers: headersFor(target.provider, target.key),
      body: JSON.stringify(payload),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
    });

  // A retry event only covers another model inside the selected provider.
  const announceStep = (to, from, failure, status) =>
    sseSend(res, {
      type: 'retry',
      attempt: steps.indexOf(from) + 1,
      reason: failure.reason,
      message: failure.message,
      status,
      from: from.model,
      to: to.model,
      fromProvider: from.provider.label,
      toProvider: to.provider.label,
    });

  let accumulated = '';
  let sawTools = false;
  let unofferedTools = false;
  let answeredModel = null;
  let lastUsage = null;
  let lastFailure = null;
  let toolSteps = 0;
  let budgetStopped = false;
  const repair = createRepairTracker({ maxAttempts: REPAIR_MAX_ATTEMPTS });
  let repairInstruction = '';
  let repairLocked = false;
  const buildStartedAt = Date.now();
  const sendBuildProgress = (state = 'running') => {
    if (mode !== 'build') return;
    sseSend(res, {
      type: 'build',
      state,
      steps: toolSteps,
      maxSteps: MAX_BUILD_STEPS,
      elapsedMs: Date.now() - buildStartedAt,
      maxMs: MAX_BUILD_MS,
    });
  };

  for (let round = 0; round <= roundLimit; round += 1) {
    if (
      mode === 'build' &&
      (toolSteps >= MAX_BUILD_STEPS || Date.now() - buildStartedAt >= MAX_BUILD_MS)
    ) {
      budgetStopped = true;
      sendBuildProgress('limit');
      break;
    }
    let roundText = '';
    let roundModel = null;
    let roundUsage = null;
    let roundTools = [];
    let streamedError = null;
    let failed = null;

    for (let attempt = 0; attempt < steps.length; attempt += 1) {
      const step = steps[attempt];
      if (!step) break;
      const next = steps[attempt + 1] ?? null;

      const payload = {
        model: step.model,
        // The instruction is added to the outgoing payload, not the saved
        // conversation, so a tool-less retry cannot still claim tools are on.
        messages: withToolInstruction(conversation, tools),
        stream: true,
        max_tokens: settings.maxTokens,
      };
      // `usage` and the `models` fallback array are OpenRouter extensions; other
      // providers reject unknown fields, so they only go where they belong.
      if (step.provider.id === 'openrouter') {
        payload.usage = { include: true };
        // Belt and braces: never hand OpenRouter more than three ids, and never
        // mix in a model that belongs to another service.
        const rest = steps
          .slice(attempt + 1)
          .filter((later) => later.provider.id === 'openrouter')
          .map((later) => later.model)
          .slice(0, 2);
        if (rest.length > 0) payload.models = [step.model, ...rest];
      }
      if (tools.length > 0) payload.tools = tools;
      if (typeof settings.temperature === 'number') payload.temperature = settings.temperature;

      const attemptStarted = Date.now();
      let upstream;
      let rejectedBody = null;
      try {
        upstream = await post(step, payload);
        // A model can advertise tool support and still reject the parameter.
        // Retry the same model once without tools instead of failing the turn.
        if (upstream.status === 400 && Array.isArray(payload.tools)) {
          await upstream.text().catch(() => '');
          const plain = { ...payload, messages: conversation };
          delete plain.tools;
          upstream = await post(step, plain);
          tools = [];
        }
        // If an API revision ever objects to the fallback array, drop it and
        // try the leading model rather than failing the whole turn. The body
        // is kept, because reading it twice is not possible.
        if (step.provider.id === 'openrouter' && upstream.status === 400 && Array.isArray(payload.models)) {
          const complaint = await upstream.text().catch(() => '');
          if (/models/i.test(complaint)) {
            const plain = { ...payload };
            delete plain.models;
            upstream = await post(step, plain);
          } else {
            rejectedBody = complaint;
          }
        }
      } catch (error) {
        if (controller.signal.aborted) break;
        failed = { retry: true, reason: 'network', message: String(error?.message ?? error) };
        statusLog.record({
          model: step.model,
          status: 'network',
          ms: Date.now() - attemptStarted,
          attempt: attempt + 1,
        });
        if (next) {
          announceStep(next, step, failed, null);
          await sleep(350 * (attempt + 1));
        }
        continue;
      }

      if (upstream.ok) {
        const local = { text: '', model: null, usage: null, error: null, toolCalls: [] };
        let streamFailed = false;
        try {
          await forwardStream(upstream, res, local);
        } catch (error) {
          if (!controller.signal.aborted) {
            failed = { retry: false, reason: 'stream', message: String(error?.message ?? error) };
            streamFailed = true;
          }
        }
        statusLog.record({
          model: local.model ?? step.model,
          // A stream that broke off is not a success, and the page says so.
          status: streamFailed || local.error ? 'stream' : 'ok',
          ms: Date.now() - attemptStarted,
          attempt: attempt + 1,
        });
        roundText = local.text;
        roundModel = local.model;
        roundUsage = local.usage;
        // Every tool call in the assistant message needs a matching tool
        // result, so cap the list before it is stored and execute exactly that
        // list. Giving the model a generated id also keeps the assistant call
        // and its result paired when a provider omits the id.
        // Never execute a tool call from a response that was not given tools.
        // A provider can return tool_calls anyway (or reject the tools parameter
        // and then return one); running it would bypass the user's Tools switch
        // and, with auto-approve, write without a card.
        const toolsWereOffered = tools.length > 0;
        if (!toolsWereOffered && local.toolCalls.length > 0) unofferedTools = true;
        roundTools = toolsWereOffered
          ? local.toolCalls
              .filter((call) => call && call.function?.name)
              .slice(0, MAX_TOOL_CALLS)
              .map((call, index) => ({ ...call, id: call.id || `call_${round}_${index}` }))
          : [];
        if (roundTools.length > 0) sawTools = true;
        // Some free models write their tool call as text instead of using the
        // protocol: "<tool_call><function=write_file><parameter=path>…". Nothing
        // runs that, so the model appears to do nothing and the turn ends with
        // no file written. Recover the call and send it down the same approval
        // path as a real one, but only when tools were actually offered.
        if (roundTools.length === 0 && /<tool_call>/i.test(roundText)) {
          const recovered = parseTextToolCalls(roundText);
          if (recovered.calls.length > 0) {
            roundText = recovered.text;
            if (toolsWereOffered) {
              roundTools = recovered.calls.map((call, index) => ({
                id: `text_${round}_${index}`,
                type: 'function',
                function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
              }));
              sawTools = true;
            } else {
              unofferedTools = true;
            }
          }
        }
        // Text-parsed calls can be more numerous than protocol calls; both
        // paths must send no more calls than they receive results for.
        if (roundTools.length > MAX_TOOL_CALLS) roundTools = roundTools.slice(0, MAX_TOOL_CALLS);
        streamedError = local.error;
        break;
      }

      const raw = rejectedBody ?? (await upstream.text().catch(() => ''));
      let parsed = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = { error: { message: raw.slice(0, 300) || `HTTP ${upstream.status}` } };
      }
      const failure = classifyFailure(upstream.status, parsed, upstream.headers);
      failed = failure;
      statusLog.record({
        model: step.model,
        status: failure.reason,
        ms: Date.now() - attemptStarted,
        attempt: attempt + 1,
      });

      if (failure.reason === 'rate-limit' || failure.reason === 'upstream') {
        coolDown(step.model, failure.reason, failure.retryAfterMs);
      }

      // Nothing reached the page, so another provider may still answer. A 400
      // that is not about tools or the model is a bad request every provider
      // would refuse; it still costs one hop and then reports the last failure.
      if (roundText.length > 0 || !next) break;
      announceStep(next, step, failure, upstream.status);
      if (failure.retry) await sleep(400 * (attempt + 1) + Math.floor(Math.random() * 250));
    }

    if (streamedError && roundText.length === 0) {
      failed = {
        reason: 'upstream',
        message: streamedError?.message ?? 'Upstream error',
        limitSource: streamedError?.metadata?.limit_source ?? null,
      };
    }

    accumulated += roundText;
    if (roundModel) {
      answeredModel = roundModel;
      cooling.delete(roundModel);
    }
    if (roundUsage) lastUsage = roundUsage;
    if (failed) lastFailure = failed;

    if (controller.signal.aborted) break;
    if (roundTools.length === 0) break;

    if (round >= roundLimit) {
      sseSend(res, { type: 'retry', reason: 'tool-limit', message: 'Stopped after the tool round limit.' });
      break;
    }

    conversation.push({ role: 'assistant', content: roundText, tool_calls: roundTools });
    for (const call of roundTools) {
      if (
        mode === 'build' &&
        (toolSteps >= MAX_BUILD_STEPS || Date.now() - buildStartedAt >= MAX_BUILD_MS)
      ) {
        budgetStopped = true;
        sendBuildProgress('limit');
        break;
      }
      toolSteps += 1;
      const name = call.function.name;
      const input = safeJson(call.function.arguments);
      let outcome;
      const blocked = repairLocked;
      if (blocked) {
        outcome = {
          ok: false,
          content:
            'Error: the repair limit was reached. No more tools will run; report what still fails and what you changed.',
        };
      } else if (planMode && !PLAN_TOOL_NAMES.has(name)) {
        // Defence in depth: a provider may ignore the filtered tool list.
        outcome = {
          ok: false,
          content: `Error: Plan mode is read-only. \`${name}\` is not available until the user presses Build.`,
        };
      } else {
        outcome = await runToolConfirmed(
          res,
          name,
          input,
          {
            getCatalog,
            workspace: turnWorkspace,
            chats: chatLibrary,
            github: github(),
            githubClone: (repo, folder) =>
              cloneGithubRepo({
                root: turnWorkspace.root,
                token: secrets().get('GITHUB_TOKEN') ?? '',
                repo,
                folder,
              }),
            githubPull: (repo, folder) =>
              pullGithubRepo({
                root: turnWorkspace.root,
                token: secrets().get('GITHUB_TOKEN') ?? '',
                repo,
                folder,
              }),
            githubPush: (repo, folder) =>
              pushGithubRepo({
                root: turnWorkspace.root,
                token: secrets().get('GITHUB_TOKEN') ?? '',
                repo,
                folder,
              }),
            githubBranch: (folder, name, create) =>
              switchGithubBranch({ root: turnWorkspace.root, folder, name, create }),
            notify: async (text) => {
              const webhook = secrets().get('NOTIFY_WEBHOOK_URL') ?? '';
              if (!webhook) {
                throw new Error('Add NOTIFY_WEBHOOK_URL in the Secrets panel first.');
              }
              let host = '';
              try {
                host = new URL(webhook).hostname.toLowerCase();
              } catch {
                throw new Error('NOTIFY_WEBHOOK_URL is not a valid URL.');
              }
              const payload = /(^|\.)discord(app)?\.com$/.test(host) ? { content: text } : { text };
              await postAsText(webhook, { body: JSON.stringify(payload), contentType: 'application/json' });
            },
            commands: runner,
            processes: processManager,
            processRoot: turnWorkspace.root ?? '',
            screenshot: capturePreview,
            browser: browserManager,
            checkpoints: checkpointStore,
            checkpointOwner: previewKey(draftId, requestedWorkspace),
            previewLink: (entry) => previewLinkFor(entry, draftId, requestedWorkspace),
            planMode,
            // stdout/stderr reach the page while the process is still running.
            onCommandOutput: (chunk) =>
              sseSend(res, { type: 'command', chunk: chunk.text, stream: chunk.stream }),
          },
          controller.signal,
        );
      }
      // An already-open browser is the cheapest verification loop: reload the
      // page after a page edit and hand the model the resulting text, errors and
      // failed requests instead of making it ask for another snapshot. This is
      // best effort; a broken browser must not turn a successful write into a
      // failed tool call.
      if (
        mode === 'build' &&
        outcome.ok &&
        browserManager.isOpen() &&
        browserShouldRecheck(name, input.path)
      ) {
        try {
          const browserCheck = await browserManager.feedback({ reload: true });
          if (browserCheck?.content) {
            outcome = {
              ...outcome,
              browser: browserCheck,
              content: `${outcome.content}\n\nAutomatic browser check after the edit:\n${browserCheck.content}`,
            };
          }
        } catch (error) {
          outcome = {
            ...outcome,
            content: `${outcome.content}\n\nAutomatic browser check failed: ${String(error?.message ?? error)}`,
          };
        }
      }
      // A page was just written or patched: hand the model its link in the same
      // tool result, so even a model that never calls preview_link can show it.
      if (mode === 'build' && outcome.ok) {
        const page = previewPageFrom(outcome, name, input);
        if (page) {
          const link = await previewLinkFor(page, draftId, requestedWorkspace);
          if (link.ok) {
            outcome = {
              ...outcome,
              content: `${outcome.content}\n\nPreview link: ${link.url}`,
              previewUrl: link.url,
              previewEntry: link.entry,
            };
          }
        }
      }
      if (!blocked && mode === 'build') {
        repair.noteMutation(name, outcome);
        const verdict = repair.observe(name, outcome);
        if (verdict && verdict.state !== 'pass') {
          sseSend(res, {
            type: 'repair',
            ...verdict,
            message: repair.instruction(verdict),
          });
          if (verdict.state === 'passed') {
            repairInstruction = '';
          } else {
            repairInstruction = repair.instruction(verdict);
            if (verdict.state === 'exhausted') {
              repairLocked = true;
              tools = [];
            }
          }
        }
      }
      if (name === 'propose_plan' && outcome.ok) {
        const plan = normalizePlan(input);
        if (plan) sseSend(res, { type: 'plan', plan });
      } else if (name === 'update_plan_step' && outcome.ok) {
        sseSend(res, { type: 'plan_step', index: Number(input.index), status: String(input.status) });
      }
      conversation.push({
        role: 'tool',
        tool_call_id: call.id || `call_${round}_${name}`,
        content: outcome.content,
      });
      if (outcome.image) {
        // The tool result is text, so the image follows as a user message. It
        // is not added to the page transcript: the SSE event displays it, while
        // the saved chat keeps the text answer and tool summary.
        conversation.push(
          toUpstreamMessage({
            role: 'user',
            content:
              `Screenshot of the ${outcome.browser ? 'interactive local preview' : `local preview /${outcome.entry ?? 'index.html'}`} ` +
              `(${outcome.width ?? '?'}×${outcome.height ?? '?'}). ` +
              (outcome.browser
                ? 'Inspect the rendered state, layout, spacing, overflow and contrast; use browser_snapshot for text and errors.'
                : 'The static preview check passed. Inspect layout, spacing, overflow and contrast; fix what is visibly wrong before finishing.'),
            images: [outcome.image],
          }),
        );
      }
      sseSend(res, {
        type: 'tool',
        name,
        arguments: call.function.arguments,
        ok: outcome.ok,
        preview: outcome.content.slice(0, 300),
        screenshot: outcome.image,
        screenshotWidth: outcome.width,
        screenshotHeight: outcome.height,
        screenshotEntry: outcome.entry,
        // The page can show or copy the link the model just received.
        previewUrl: outcome.previewUrl || (name === 'preview_link' ? outcome.url : undefined),
        previewEntry: outcome.previewEntry || (name === 'preview_link' ? outcome.entry : undefined),
        // Let the page open an HTML/SVG file the model just wrote without the
        // user having to ask for a preview as a separate turn.
        path:
          name === 'scaffold_project'
            ? outcome.path
            : (name === 'write_file' || name === 'apply_patch') && typeof input.path === 'string'
              ? input.path
              : undefined,
        // A started dev server carries its own id, port and URL so the page can
        // offer Open and Stop without another request.
        process: outcome.process,
        url: outcome.process?.url || undefined,
        checkpoint: outcome.checkpoint,
        checkpointError: outcome.checkpointError,
      });
      sendBuildProgress(
        toolSteps >= MAX_BUILD_STEPS || Date.now() - buildStartedAt >= MAX_BUILD_MS
          ? 'limit'
          : 'running',
      );
    }
    if (repairInstruction) {
      conversation.push({ role: 'system', content: repairInstruction });
      repairInstruction = '';
    }
    if (
      !budgetStopped &&
      mode === 'build' &&
      (toolSteps >= MAX_BUILD_STEPS || Date.now() - buildStartedAt >= MAX_BUILD_MS)
    ) {
      budgetStopped = true;
      sendBuildProgress('limit');
    }
    if (budgetStopped) break;
  }

  // Several free models call tools and then return an empty message: the API
  // considers that turn finished, but the user asked a question and the tool
  // results are sitting in the conversation. Ask once more with no tools
  // attached, so the model has nothing to do but answer in words.
  if (!controller.signal.aborted && !budgetStopped && accumulated.trim().length === 0 && sawTools) {
    const nudgeStarted = Date.now();
    try {
      const upstream = await post({ provider, key }, {
        model: answeredModel ?? chain[0],
        messages: [
          ...conversation,
          {
            role: 'system',
            content:
              'You already ran the tools above. Answer the user now in plain text, using what the tools returned. Do not call any more tools.',
          },
        ],
        stream: true,
        max_tokens: settings.maxTokens,
        // `usage` is an OpenRouter extension; Groq and Gemini reject it, which
        // made the post-tool answer silently disappear on those providers.
        ...(provider.id === 'openrouter' ? { usage: { include: true } } : {}),
      });
      if (upstream.ok) {
        const local = { text: '', model: null, usage: null, error: null, toolCalls: [] };
        await forwardStream(upstream, res, local);
        if (local.text.trim()) {
          accumulated = local.text;
          if (local.model) answeredModel = local.model;
          if (local.usage) lastUsage = local.usage;
          statusLog.record({
            model: local.model ?? chain[0],
            status: 'ok',
            ms: Date.now() - nudgeStarted,
            attempt: 1,
          });
        } else {
          statusLog.record({
            model: chain[0],
            status: 'stream',
            ms: Date.now() - nudgeStarted,
            attempt: 1,
          });
        }
      }
    } catch {
      /* the earlier rounds still decide the outcome */
    }
  }

  // The tab closed, refreshed or lost the network before the answer finished:
  // keep what arrived so opening the chat again can recover it.
  if (draftId && accumulated.trim() && (clientGone || controller.signal.aborted)) {
    try {
      store().setDraft(draftId, { content: accumulated, model: answeredModel });
    } catch {
      /* the chat may have been deleted while the answer was streaming */
    }

    // A chat's *first* answer has no saved thread yet: the page creates it with
    // its own first save, so a tab that dies before that save would lose the
    // whole exchange. Create it here, and only when the client is already gone —
    // a live tab's save still wins, so this can never cause a stale-write
    // question for a turn that finished normally.
    try {
      if (!store().get(draftId)) {
        store().put(draftId, {
          messages: [
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'assistant', content: accumulated, model: answeredModel, usage: lastUsage },
          ],
          requests: 1,
          ...(requestedWorkspace !== undefined ? { workspace: requestedWorkspace } : {}),
        });
      }
    } catch {
      /* a failed rescue must never break a stream that already finished */
    }
  }

  if (accumulated.trim().length > 0) {
    sseSend(res, {
      type: 'done',
      model: answeredModel ?? chain[0],
      usage: lastUsage,
      tools: [],
      stopped: controller.signal.aborted,
    });
  } else if (controller.signal.aborted) {
    sseSend(res, { type: 'done', model: answeredModel ?? chain[0], stopped: true });
  } else if (budgetStopped) {
    sseSend(res, {
      type: 'error',
      reason: 'build-limit',
      message:
        `Build stopped at its ${MAX_BUILD_STEPS}-step / ${Math.round(MAX_BUILD_MS / 60000)}-minute limit. ` +
        'Files already written are safe. Send “continue” to keep building from here.',
    });
  } else {
    let hint =
      unofferedTools
        ? 'The model tried to use a tool even though tools were not offered. Turn tools on in Settings, or pick another free model, then send the message again.'
        : lastFailure?.message ??
          (sawTools
            ? 'The model used tools but never wrote an answer. Send the message again, or pick another free model.'
            : 'No model answered.');
    if (lastFailure?.reason === 'rate-limit') {
      const info = await getKeyInfo();
      const free = info?.ok ? info.freeDaily : null;
      if (free && typeof free.remaining === 'number') {
        hint += ` Free requests left today: ${free.remaining} of ${free.limit}.`;
      } else {
        hint += ' Free-model limits reset at 00:00 UTC.';
      }
    }
    if (lastFailure?.reason === 'credit') {
      hint += ' Add credits at https://openrouter.ai/settings/credits, or use free models only.';
    }
    const retryAfterMs = Number(lastFailure?.retryAfterMs) || 0;
    sseSend(res, {
      type: 'error',
      reason: lastFailure?.reason ?? 'unknown',
      message: scrubSecrets(hint),
      ...(retryAfterMs ? { retryAfterMs } : {}),
    });
  }

  res.end();
}

/* -------------------------------------------------------------- routing */

/** Route ids come from the URL: a malformed % escape is a bad request, not a crash. */
function decodeId(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function requireToken(req, res) {
  if (req.headers['x-app-token'] !== APP_TOKEN) {
    sendJson(res, 403, { error: 'Missing or invalid app token.' });
    return false;
  }
  return true;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const { pathname } = url;
  if (!requireTrustedRequest(req, res)) return;
  // Decided once per request: both the page and every JSON body read this.
  res.wantsGzip = /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));

  // HEAD is how a monitor, a proxy or `curl -I` checks the page is alive. Node
  // drops the body for a HEAD response, so the same handler serves both.
  if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/' || pathname === '/index.html')) {
    const html = (await pageHtml()).replace('__APP_TOKEN__', APP_TOKEN);
    // The page is one large inline script. Over a slow tunnel gzip is the
    // difference between a half-delivered page and a loaded one: 109 KB → 30 KB.
    const wantsGzip = res.wantsGzip === true;
    const body = wantsGzip ? gzipSync(html) : Buffer.from(html, 'utf8');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      ...(wantsGzip ? { 'content-encoding': 'gzip', vary: 'accept-encoding' } : {}),
      'content-length': body.length,
    });
    return res.end(body);
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/icon.svg') {
    try {
      const icon = await iconSvg();
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=3600',
        'content-length': icon.length,
      });
      return res.end(icon);
    } catch {
      res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
  }

  if (req.method === 'POST' && pathname === '/api/session/reset') {
    if (!requireToken(req, res)) return;
    resetCooling();
    return sendJson(res, 200, { ok: true, skipped: [] });
  }

  if (req.method === 'GET' && pathname === '/api/threads') {
    if (!requireToken(req, res)) return;
    return sendJson(res, 200, { threads: store().list(url.searchParams.get('q') ?? '') });
  }

  if (req.method === 'POST' && pathname === '/api/threads') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);
    return sendJson(res, 200, { thread: store().put(null, body) });
  }

  if (pathname.startsWith('/api/threads/')) {
    if (!requireToken(req, res)) return;
    const id = decodeId(pathname.slice('/api/threads/'.length));
    if (!id || !CHAT_ID.test(id)) {
      return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
    }

    if (req.method === 'GET') {
      const thread = store().get(id);
      return thread ? sendJson(res, 200, { thread }) : sendJson(res, 404, { error: 'No such chat.' });
    }
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await readJson(req);
      const ifRev = Number.isInteger(body?.ifRev) ? body.ifRev : undefined;
      try {
        return sendJson(res, 200, { thread: store().put(id, body, { ifRev }) });
      } catch (error) {
        if (error.status === 409) {
          return sendJson(res, 409, { error: error.message, code: 'stale', thread: error.thread });
        }
        throw error;
      }
    }
    if (req.method === 'DELETE') {
      const removed = store().remove(id);
      return sendJson(res, removed ? 200 : 404, { ok: removed });
    }
  }

  if (req.method === 'GET' && pathname === '/api/export') {
    if (!requireToken(req, res)) return;
    return sendJson(res, 200, {
      app: 'freeway',
      version: VERSION,
      exportedAt: new Date().toISOString(),
      model: loadConfig().model ?? null,
      settings: loadSettings(),
      threads: store().all(),
    });
  }

  if (req.method === 'POST' && pathname === '/api/import') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);

    // A backup carries settings and the chosen model; restore them too.
    if (body?.settings && typeof body.settings === 'object') {
      saveConfig({ settings: { ...loadSettings(), ...sanitizeSettings(body.settings) } });
    }
    if (typeof body?.model === 'string' && body.model.trim()) saveConfig({ model: body.model.trim() });

    return sendJson(res, 200, store().importAll(body, body?.mode === 'replace' ? 'replace' : 'merge'));
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    const config = loadConfig();
    const provider = getProvider(config.provider) ?? getProvider('openrouter');
    return sendJson(res, 200, {
      hasKey: Boolean(providerKey(provider)),
      requiresAccount: Boolean(provider.requiresAccount),
      hasAccount: Boolean(accountFor(provider, config, process.env)),
      provider: provider.id,
      model: config.model ?? null,
      workspace: config.workspace ?? '',
      version: VERSION,
      platform: process.platform,
      settings: loadSettings(),
      skipped: coolingIds(),
    });
  }

  // Kept separate from /api/config so the boot payload stays small enough to
  // skip compression; the page fetches this once at start.
  if (req.method === 'GET' && pathname === '/api/providers') {
    const config = loadConfig();
    const provider = getProvider(config.provider) ?? getProvider('openrouter');
    const providers = await Promise.all(
      PROVIDERS.map(async (entry) => ({
        ...publicView(
          entry,
          Boolean(providerKey(entry)),
          Boolean(accountFor(entry, config, process.env)),
        ),
        // Hosted providers are always "available"; only a local daemon can be off.
        available: entry.local ? await localProviderUp(entry) : true,
      })),
    );
    return sendJson(res, 200, { provider: provider.id, providers });
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req);
    const patch = {};
    if (typeof body.apiKey === 'string') {
      const key = body.apiKey.trim();
      if (!key.startsWith('sk-or-')) {
        return sendJson(res, 400, { error: 'That does not look like an OpenRouter key (expected sk-or-...).' });
      }
      patch.apiKey = key;
    }
    if (typeof body.provider === 'string') {
      const chosen = getProvider(body.provider.trim());
      if (!chosen) return sendJson(res, 400, { error: `Unknown provider "${body.provider}".` });
      patch.provider = chosen.id;
    }
    // Key updates arrive as { key: { id, value } }; an empty value clears it.
    if (body.key && typeof body.key === 'object') {
      const chosen = getProvider(String(body.key.id ?? '').trim());
      if (!chosen) return sendJson(res, 400, { error: `Unknown provider "${body.key.id}".` });
      const value = typeof body.key.value === 'string' ? body.key.value.trim() : '';
      if (value && chosen.keyPrefix && !value.startsWith(chosen.keyPrefix)) {
        // Groq and Grok get confused constantly; say which one this is.
        const hint =
          chosen.id === 'groq'
            ? ' Groq (gsk_…) is not xAI’s Grok — Grok is paid and is not offered here.'
            : '';
        return sendJson(res, 400, {
          error: `That does not look like a ${chosen.label} key (expected ${chosen.keyPrefix}...).${hint}`,
        });
      }
      if (value && value.length > 400) {
        return sendJson(res, 400, { error: 'That key is implausibly long.' });
      }
      const account = typeof body.key.account === 'string' ? body.key.account.trim() : '';
      if (chosen.requiresAccount) {
        if (account && !/^[a-f0-9]{32}$/i.test(account)) {
          return sendJson(res, 400, {
            error: `${chosen.label} Account IDs are 32 hexadecimal characters.`,
          });
        }
        if (value && !account) {
          return sendJson(res, 400, {
            error: `${chosen.label} needs both an API token and the 32-character Account ID.`,
          });
        }
        if (!value && account) {
          return sendJson(res, 400, {
            error: `Paste the ${chosen.label} API token as well, or clear both fields.`,
          });
        }
      }
      if (chosen.id === 'openrouter') {
        patch.apiKey = value;
      } else {
        const keys = { ...(loadConfig().providerKeys ?? {}) };
        if (value) keys[chosen.id] = value;
        else delete keys[chosen.id];
        patch.providerKeys = keys;
        if (chosen.requiresAccount) {
          const accounts = { ...(loadConfig().providerAccounts ?? {}) };
          if (account) accounts[chosen.id] = account;
          else delete accounts[chosen.id];
          patch.providerAccounts = accounts;
        }
      }
      // A new key means the cached model list may belong to another account.
      providerCatalogs.delete(chosen.id);
    }
    if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
    if (typeof body.workspace === 'string') patch.workspace = body.workspace.trim().slice(0, 500);
    if (body.settings && typeof body.settings === 'object') {
      patch.settings = { ...(loadConfig().settings ?? {}), ...sanitizeSettings(body.settings) };
    }
    saveConfig(patch);
    return sendJson(res, 200, { ok: true, settings: loadSettings() });
  }

  if (req.method === 'GET' && pathname === '/api/models') {
    const provider = getProvider(url.searchParams.get('provider') || activeProvider().id);
    if (!provider) {
      return sendJson(res, 400, { error: `Unknown provider "${url.searchParams.get('provider')}".` });
    }
    const config = loadConfig();
    if (provider.id !== 'openrouter' && !provider.local && !providerKey(provider)) {
      return sendJson(res, 400, {
        error: `Add a ${provider.label} key first.`,
        provider: provider.id,
        needsKey: true,
      });
    }
    if (provider.requiresAccount && !accountFor(provider, config, process.env)) {
      return sendJson(res, 400, {
        error: `Add the ${provider.label} Account ID first.`,
        provider: provider.id,
        needsAccount: true,
      });
    }
    try {
      if (provider.id === 'openrouter') {
        const models = await getCatalog();
        const rows = filterModels(models, {
          q: url.searchParams.get('q') ?? '',
          freeOnly: url.searchParams.get('free') === '1',
          needTools: url.searchParams.get('tools') === '1',
          needVision: url.searchParams.get('vision') === '1',
          minContext: Number(url.searchParams.get('minContext') ?? 0) || 0,
        });
        return sendJson(res, 200, { provider: provider.id, tier: 'verified', total: models.length, models: rows });
      }

      const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
      const minContext = Number(url.searchParams.get('minContext') ?? 0) || 0;
      const all = await getProviderModels(provider, url.searchParams.get('refresh') === '1', config);
      const rows = all.filter(
        (model) =>
          (!query || model.id.toLowerCase().includes(query)) &&
          (model.context ?? 0) >= minContext,
      );
      return sendJson(res, 200, {
        provider: provider.id,
        tier: 'free-tier',
        total: all.length,
        models: rows,
      });
    } catch (error) {
      return sendJson(res, error.status ?? 502, {
        error: scrubSecrets(String(error.message ?? error)),
        provider: provider.id,
      });
    }
  }

  if (req.method === 'GET' && pathname === '/api/key') {
    if (!requireToken(req, res)) return;
    const provider = activeProvider();
    if (provider.id !== 'openrouter') {
      return sendJson(res, 200, {
        ok: false,
        provider: provider.id,
        message: `${provider.label} does not report quota here.`,
      });
    }
    const info = await getKeyInfo();
    return sendJson(res, info.ok ? 200 : 502, info);
  }

  // Read-only session telemetry for the Status tab. No key, no prompts, no
  // history: only what this run already did.
  if (req.method === 'GET' && pathname === '/api/status') {
    return sendJson(res, 200, {
      version: VERSION,
      provider: activeProvider().id,
      summary: statusLog.summary(),
      cooling: coolingIds().map((id) => {
        const item = cooling.get(id);
        const at = item?.at ?? Date.now();
        const until = item?.until ?? at + 60_000;
        return {
          model: id,
          reason: item?.reason ?? null,
          at: new Date(at).toISOString(),
          until: new Date(until).toISOString(),
          retryAfterMs: Math.max(0, until - Date.now()),
        };
      }),
      recent: statusLog.list(),
      catalog: {
        models: catalog.models.length,
        ageMs: catalog.fetchedAt ? Date.now() - catalog.fetchedAt : null,
      },
      limits: {
        attempts: MAX_ATTEMPTS,
        toolRounds: MAX_TOOL_ROUNDS,
        toolCalls: MAX_TOOL_CALLS,
        buildSteps: MAX_BUILD_STEPS,
        buildMs: MAX_BUILD_MS,
        repairAttempts: REPAIR_MAX_ATTEMPTS,
        processes: processLimits.MAX_PROCESSES,
        processLogBytes: processLimits.MAX_LOG_BYTES,
      },
    });
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    if (!requireToken(req, res)) return;
    return handleChat(req, res);
  }

  if (req.method === 'POST' && pathname === '/api/github/connect') {
    if (!requireToken(req, res)) return;
    try {
      const body = await readJson(req, 16 * 1024);
      const token = typeof body?.token === 'string' ? body.token.trim() : '';
      if (!token) return sendJson(res, 400, { error: 'Paste a GitHub token to connect.' });
      if (token.length > 1024) return sendJson(res, 400, { error: 'That GitHub token is too long.' });
      // Validate before saving, so a typo never replaces a working connection.
      const client = createGithub(token);
      const viewer = await client.viewer();
      secrets().set('GITHUB_TOKEN', token);
      return sendJson(res, 200, { ok: true, viewer });
    } catch (error) {
      return sendJson(res, error.status ?? 502, { error: scrubSecrets(String(error.message ?? error)) });
    }
  }

  if (req.method === 'DELETE' && pathname === '/api/github') {
    if (!requireToken(req, res)) return;
    try {
      secrets().remove('GITHUB_TOKEN');
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 500, { error: scrubSecrets(String(error.message ?? error)) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/github/clone') {
    if (!requireToken(req, res)) return;
    try {
      const body = await readJson(req, 16 * 1024);
      const token = secrets().get('GITHUB_TOKEN') ?? '';
      if (!token) {
        return sendJson(res, 400, { error: 'Connect GitHub in the GitHub panel before cloning.' });
      }
      const chatId = typeof body?.chat === 'string' && body.chat ? body.chat : null;
      if (chatId && !CHAT_ID.test(chatId)) {
        return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
      }
      const requested = Object.prototype.hasOwnProperty.call(body ?? {}, 'workspace')
        ? body.workspace
        : undefined;
      const sandbox = workspaceFor(chatId, requested);
      if (!sandbox.isReady) {
        return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
      }
      const result = await cloneGithubRepo({
        root: sandbox.root,
        token,
        repo: body?.repo,
        folder: body?.folder,
      });
      return sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      return sendJson(res, error.status ?? 502, { error: scrubSecrets(String(error.message ?? error)) });
    }
  }

  if (pathname === '/api/github') {
    if (!requireToken(req, res)) return;
    const client = github();
    if (!client.hasToken) {
      return sendJson(res, 400, {
        error: 'No GitHub token is saved. Connect GitHub in the GitHub panel.',
      });
    }
    try {
      const what = url.searchParams.get('what') ?? 'viewer';
      const repo = url.searchParams.get('repo') ?? '';
      const state = url.searchParams.get('state') ?? 'open';
      const number = url.searchParams.get('number') ?? '';
      const sha = url.searchParams.get('sha') ?? '';
      const branch = url.searchParams.get('branch') ?? '';
      if (what === 'viewer') return sendJson(res, 200, await client.viewer());
      if (what === 'repos') return sendJson(res, 200, { items: await client.repos() });
      if (what === 'repo') return sendJson(res, 200, await client.repo(repo));
      if (what === 'branches') return sendJson(res, 200, { items: await client.branches(repo) });
      if (what === 'issues') return sendJson(res, 200, { items: await client.issues(repo, state) });
      if (what === 'issue') return sendJson(res, 200, await client.issue(repo, number));
      if (what === 'pulls') return sendJson(res, 200, { items: await client.pulls(repo, state) });
      if (what === 'pull') return sendJson(res, 200, await client.pull(repo, number));
      if (what === 'commits') return sendJson(res, 200, { items: await client.commits(repo, branch) });
      if (what === 'commit') return sendJson(res, 200, await client.commit(repo, sha));
      if (what === 'reviews') return sendJson(res, 200, { items: await client.reviews(repo, number) });
      if (what === 'comments') return sendJson(res, 200, { items: await client.comments(repo, number) });
      if (what === 'workflows') return sendJson(res, 200, { items: await client.workflows(repo) });
      if (what === 'runs') return sendJson(res, 200, { items: await client.workflowRuns(repo) });
      if (what === 'releases') return sendJson(res, 200, { items: await client.releases(repo) });
      return sendJson(res, 400, { error: `Unknown view "${what}".` });
    } catch (error) {
      return sendJson(res, error.status ?? 502, { error: scrubSecrets(String(error.message ?? error)) });
    }
  }

  if (pathname === '/api/secrets') {
    if (!requireToken(req, res)) return;
    try {
      if (req.method === 'GET') return sendJson(res, 200, { names: secrets().list() });
      if (req.method === 'POST') {
        const body = await readJson(req, 32 * 1024);
        const saved = secrets().set(body?.name, body?.value);
        return sendJson(res, 200, { ok: true, saved, names: secrets().list() });
      }
      if (req.method === 'DELETE') {
        const removed = secrets().remove(url.searchParams.get('name') ?? '');
        return sendJson(res, removed ? 200 : 404, { ok: removed, names: secrets().list() });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      return sendJson(res, error.status ?? 500, {
        error: scrubSecrets(String(error.message ?? error)),
      });
    }
  }

  if (req.method === 'POST' && pathname === '/api/workspace/archive') {
    if (!requireToken(req, res)) return;
    try {
      const body = await readJson(req, 8 * 1024);
      const chatId = typeof body?.chat === 'string' && CHAT_ID.test(body.chat) ? body.chat : null;
      if (body?.chat && !chatId) return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
      const requested = Object.prototype.hasOwnProperty.call(body ?? {}, 'workspace') ? body.workspace : undefined;
      const sandbox = workspaceFor(chatId, requested);
      const archive = createWorkspaceArchive(sandbox);
      res.writeHead(200, {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${archive.name}"`,
        'content-length': archive.buffer.length,
        'cache-control': 'no-store',
      });
      res.end(archive.buffer);
      return;
    } catch (error) {
      return sendJson(res, error.status ?? 500, { error: scrubSecrets(String(error.message ?? error)) });
    }
  }

  if (req.method === 'POST' && pathname === '/api/export/document') {
    if (!requireToken(req, res)) return;
    try {
      const body = await readJson(req, 2 * 1024 * 1024);
      const markdown = typeof body?.markdown === 'string' ? body.markdown : '';
      if (!markdown.trim()) return sendJson(res, 400, { error: 'There is no Markdown to export.' });
      const format = String(body?.format ?? 'pdf').toLowerCase();
      if (!['pdf', 'docx'].includes(format)) return sendJson(res, 400, { error: 'Format must be pdf or docx.' });
      const title = String(body?.title ?? 'Freeway export').trim().slice(0, 120) || 'Freeway export';
      const buffer = format === 'docx' ? buildDocx(markdown, { title }) : buildPdf(markdown, { title });
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        'content-type': format === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/pdf',
        'content-disposition': `attachment; filename="freeway-${stamp}.${format}"`,
        'content-length': buffer.length,
        'cache-control': 'no-store',
      });
      res.end(buffer);
      return;
    } catch (error) {
      return sendJson(res, error.status ?? 500, { error: scrubSecrets(String(error.message ?? error)) });
    }
  }

  if (pathname === '/api/fs' || pathname.startsWith('/api/fs/')) {
    if (!requireToken(req, res)) return;
    const chatId = url.searchParams.get('chat') || null;
    if (chatId && !CHAT_ID.test(chatId)) {
      return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
    }
    const requested = url.searchParams.has('workspace') ? url.searchParams.get('workspace') : undefined;
    const sandbox = workspaceFor(chatId, requested);
    try {
      if (req.method === 'GET' && pathname === '/api/fs') {
        if (!sandbox.isReady) {
          return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
        }
        return sendJson(res, 200, sandbox.list(url.searchParams.get('path') ?? '.'));
      }
      if (req.method === 'GET' && pathname === '/api/fs/read') {
        if (!sandbox.isReady) {
          return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
        }
        return sendJson(res, 200, sandbox.read(url.searchParams.get('path') ?? ''));
      }
      // The page asks this when Preview is opened without an active entry, so
      // a generated page is not lost when the tab or chat is reopened.
      if (req.method === 'GET' && pathname === '/api/fs/preview-entry') {
        if (!sandbox.isReady) {
          return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
        }
        const entry = sandbox.findPreviewEntry();
        if (!entry) {
          return sendJson(res, 404, {
            error: 'No HTML, SVG or Markdown file is available to preview.',
          });
        }
        return sendJson(res, 200, { entry });
      }
      if (req.method === 'POST' && pathname === '/api/fs/write') {
        const body = await readJson(req, 2 * 1024 * 1024);
        // Writes name their chat in the body because the URL is already built
        // by the page with the file path and workspace policy.
        const bodyChat = typeof body?.chat === 'string' && CHAT_ID.test(body.chat) ? body.chat : null;
        if (body?.chat && !bodyChat) return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
        const bodyWorkspace =
          body?.workspace === null || typeof body?.workspace === 'string' ? body.workspace : undefined;
        const target = workspaceFor(bodyChat, bodyWorkspace);
        if (!target.isReady) {
          return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
        }
        return sendJson(res, 200, { ok: true, ...target.write(body?.path, body?.content) });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      return sendJson(res, error.status ?? 500, {
        error: scrubSecrets(String(error?.message ?? error)),
      });
    }
  }

  // Start the loopback workspace server and return its tokenised entry URL.
  // This is deliberately separate from the saved remote-preview address below.
  if (req.method === 'POST' && pathname === '/api/preview/serve') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req, 4096);
    const chatId = typeof body?.chatId === 'string' && CHAT_ID.test(body.chatId) ? body.chatId : null;
    if (body?.chatId && !chatId) return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
    const requestedWorkspace =
      body?.workspace === null || typeof body?.workspace === 'string' ? body.workspace : undefined;
    const sandbox = workspaceFor(chatId, requestedWorkspace);
    if (!sandbox.isReady) {
      return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
    }
    const wanted = String(body?.entry ?? '').trim();
    if (!wanted) return sendJson(res, 400, { error: 'Choose an HTML file to preview.' });
    if (!/\.(html?|svg)$/i.test(wanted)) {
      return sendJson(res, 400, { error: 'The local server preview starts from an HTML or SVG file.' });
    }
    try {
      const file = sandbox.readAsset(wanted);
      // Pinned to this chat, and only one at a time: a URL from the previous
      // chat cannot keep serving that chat's files after a switch.
      const preview = localPreviewServer(chatId, requestedWorkspace);
      const served = await preview.open(file.path, {
        host: body?.host === 'localhost' ? 'localhost' : '127.0.0.1',
      });
      return sendJson(res, 200, { ...served, entry: file.path });
    } catch (error) {
      return sendJson(res, error.status ?? 500, {
        error: scrubSecrets(String(error?.message ?? error)),
      });
    }
  }

  // User-facing capture from the Preview panel. This is deliberately separate
  // from the model's vision gate: clicking Capture is an explicit request, so
  // it works for any model and keeps the image in the page for download.
  if (req.method === 'POST' && pathname === '/api/preview/screenshot') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req, 8192);
    const chatId = typeof body?.chatId === 'string' && CHAT_ID.test(body.chatId) ? body.chatId : null;
    if (body?.chatId && !chatId) return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
    const requestedWorkspace =
      body?.workspace === null || typeof body?.workspace === 'string' ? body.workspace : undefined;
    const sandbox = workspaceFor(chatId, requestedWorkspace);
    if (!sandbox.isReady) {
      return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
    }
    const viewport = screenshotViewport(body?.viewport);
    try {
      const url = typeof body?.url === 'string' ? body.url.trim() : '';
      let shot;
      let entry = typeof body?.entry === 'string' ? body.entry.trim() : '';
      if (url) {
        shot = await captureScreenshot({
          url,
          width: viewport.width,
          height: viewport.height,
          maxChars: 2_000_000,
        });
        entry ||= 'current preview';
      } else {
        entry = entry || sandbox.findPreviewEntry() || '';
        if (!entry) {
          return sendJson(res, 400, { error: 'No HTML or SVG page is available to capture.' });
        }
        if (!/\.(html?|svg)$/i.test(entry)) {
          return sendJson(res, 400, {
            error: 'The local screenshot starts from an HTML or SVG file. Markdown previews cannot be captured.',
          });
        }
        const preview = localPreviewServer(chatId, requestedWorkspace);
        const opened = await preview.open(entry);
        shot = await captureScreenshot({
          url: opened.url,
          width: viewport.width,
          height: viewport.height,
          maxChars: 2_000_000,
        });
        entry = opened.entry || entry;
      }
      return sendJson(res, 200, {
        ok: true,
        ...shot,
        entry,
        viewport: body?.viewport || 'desktop',
      });
    } catch (error) {
      return sendJson(res, error.status ?? 500, {
        error: scrubSecrets(String(error?.message ?? error)),
      });
    }
  }

  if (req.method === 'POST' && pathname === '/api/preview/close') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req, 4096).catch(() => ({}));
    closePreviewServer(typeof body?.chatId === 'string' ? body.chatId : null);
    return sendJson(res, 200, { ok: true });
  }

  // The preview address belongs to one chat and is stored on its own, so saving
  // it never fights with the debounced message save or its stale-rev guard.
  if (req.method === 'POST' && pathname.startsWith('/api/preview/')) {
    if (!requireToken(req, res)) return;
    const id = decodeId(pathname.slice('/api/preview/'.length));
    if (!id) return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
    const body = await readJson(req, 4096);
    const thread = store().setPreview(id, body?.url);
    if (!thread) return sendJson(res, 404, { error: 'No such chat.' });
    return sendJson(res, 200, { thread: { id: thread.id, preview: thread.preview } });
  }

  if (pathname === '/api/checkpoints/latest' || pathname === '/api/checkpoints/undo') {
    if (!requireToken(req, res)) return;
    const body = req.method === 'POST' ? await readJson(req, 4096) : {};
    // A GET has no JSON body. The page passes both values in the query string,
    // including an empty workspace= for a new managed-workspace chat.
    const chatValue = req.method === 'GET' ? url.searchParams.get('chat') : body?.chat;
    const workspaceValue =
      req.method === 'GET'
        ? (url.searchParams.has('workspace') ? url.searchParams.get('workspace') : undefined)
        : (body?.workspace === null || typeof body?.workspace === 'string' ? body.workspace : undefined);
    const chat = typeof chatValue === 'string' && CHAT_ID.test(chatValue) ? chatValue : null;
    if (chatValue && !chat) return sendJson(res, 400, { error: 'Missing or invalid chat id.' });
    const requested = workspaceValue;
    try {
      const sandbox = workspaceFor(chat, requested);
      if (!sandbox.isReady) {
        return sendJson(res, 400, { error: 'No workspace folder is set. Choose one in Settings.' });
      }
      const owner = previewKey(chat, requested);
      if (req.method === 'GET' && pathname === '/api/checkpoints/latest') {
        return sendJson(res, 200, { checkpoint: checkpointStore.latest(owner, sandbox) });
      }
      if (req.method === 'POST' && pathname === '/api/checkpoints/undo') {
        const checkpoint = checkpointStore.undo(owner, sandbox, body?.id);
        return sendJson(res, 200, { ok: true, checkpoint });
      }
      return sendJson(res, 405, { error: 'Method not allowed.' });
    } catch (error) {
      return sendJson(res, error.status ?? 500, {
        error: scrubSecrets(String(error?.message ?? error)),
      });
    }
  }

  if (req.method === 'POST' && pathname === '/api/chat/confirm') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req, 4096);
    const entry = pendingConfirms.get(String(body?.id ?? ''));
    if (!entry) return sendJson(res, 404, { error: 'No action is waiting for an answer.' });
    entry.settle(Boolean(body?.allow));
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/quit') {
    if (!requireToken(req, res)) return;
    // A quit must not leave a dev server or headless browser running.
    browserManager.closeSync();
    processManager.stopAllSync();
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 120);
    return;
  }

  // Managed dev servers are listed and stopped from the page too, so a server
  // can be closed without another chat turn.
  if (req.method === 'GET' && pathname === '/api/processes') {
    if (!requireToken(req, res)) return;
    return sendJson(res, 200, {
      processes: processManager.list(),
      limits: {
        maxProcesses: processLimits.MAX_PROCESSES,
        maxLogBytes: processLimits.MAX_LOG_BYTES,
      },
    });
  }

  if (req.method === 'POST' && pathname === '/api/processes/stop') {
    if (!requireToken(req, res)) return;
    const body = await readJson(req, 4096);
    const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : '';
    const stopped = await processManager.stop(id || undefined);
    if (id && !stopped) return sendJson(res, 404, { error: 'No such process.' });
    return sendJson(res, 200, { ok: true, stopped: stopped ?? [] });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

/* -------------------------------------------------------------- startup */

function openBrowser(target) {
  if (process.env.NO_OPEN === '1') return;
  try {
    // The launcher and the browser it starts are local programs, not trusted
    // code. A normal desktop launch must not hand them the provider keys that
    // happen to be in this process's environment.
    const env = browserEnv(process.env);
    if (process.platform === 'win32') {
      // Edge gets a window without tabs; a PC without Edge exits non-zero, and
      // 'error' never fires because cmd itself started fine. Both paths fall
      // back to the default browser.
      const fallback = () => {
        spawn('cmd', ['/c', 'start', '', target], { env, stdio: 'ignore', windowsHide: true }).on(
          'error',
          () => {},
        );
      };
      const child = spawn('cmd', ['/c', 'start', '', 'msedge', `--app=${target}`], {
        env,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.on('error', fallback);
      child.on('exit', (code) => {
        if (code !== 0) fallback();
      });
    } else if (process.platform === 'darwin') {
      spawn('open', [target], { env, stdio: 'ignore' }).on('error', () => {});
    } else {
      // No xdg-open (a server, WSL, a bare container) must not kill the app:
      // spawn reports a missing program as an asynchronous 'error' event, and an
      // unhandled one takes the whole process down a moment after it started.
      // The URL is printed either way, so failing to open a browser is harmless.
      spawn('xdg-open', [target], { env, stdio: 'ignore' }).on('error', () => {});
    }
  } catch {
    /* the URL is printed below either way */
  }
}

/* -------------------------------------------------------------- doctor */

/** Is there already a Freeway answering on this address? */
async function probeExistingApp(target) {
  try {
    const response = await fetch(`${target}/api/config`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const body = await response.json().catch(() => null);
    return body && typeof body.version === 'string' && typeof body.platform === 'string' ? body : null;
  } catch {
    return null;
  }
}

/** `start.cmd --doctor`: prove the install works without sending a single prompt. */
async function runDoctor() {
  const lines = [];
  let failed = 0;
  const mark = (ok, label, detail = '') => {
    if (!ok) failed += 1;
    lines.push(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  mark(true, `Node.js ${process.versions.node}`);

  const location = configLocation();
  try {
    fs.mkdirSync(location.dir, { recursive: true });
    const probe = path.join(location.dir, '.doctor-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    mark(true, `Config folder ${location.dir}`, 'writable');
  } catch (error) {
    mark(false, `Config folder ${location.dir}`, String(error?.message ?? error));
  }

  const free = await new Promise((resolve) => {
    const probe = http.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(PORT, HOST, () => probe.close(() => resolve(true)));
  });
  if (free) {
    mark(true, `Port ${PORT} on ${HOST}`, 'available');
  } else {
    const running = await probeExistingApp(
      `http://${HOST === '0.0.0.0' || HOST === '::' ? DEFAULT_HOST : HOST}:${PORT}`,
    );
    mark(
      false,
      `Port ${PORT} on ${HOST}`,
      running
        ? `Freeway ${running.version} is already running there`
        : 'used by another program — start with --port 3003',
    );
  }

  if (apiKey()) lines.push('  ok   OpenRouter key — saved');
  else lines.push('  --   OpenRouter key — not set yet; the first screen asks for one');

  try {
    const response = await fetch(`${BASE_URL}/models?output_modalities=text`, {
      signal: AbortSignal.timeout(15_000),
    });
    mark(response.ok, 'OpenRouter reachable', `HTTP ${response.status}`);
  } catch (error) {
    mark(false, 'OpenRouter reachable', String(error?.message ?? error));
  }

  console.log(`Freeway ${VERSION} — self-check`);
  console.log(`  config file: ${location.file}`);
  console.log(lines.join('\n'));
  console.log(
    failed === 0
      ? '\nEverything needed to start is in place. Run it without --doctor.'
      : `\n${failed} check(s) failed — see above.`,
  );
  return failed === 0 ? 0 : 1;
}

export function createServer() {
  const server = http.createServer((req, res) => {
    route(req, res).catch((error) => {
      const status = error?.status ?? 500;
      if (status >= 500) {
        console.error(scrubSecrets(error?.stack ?? error?.message ?? String(error)));
      }
      if (!res.headersSent) {
        sendJson(res, status, { error: scrubSecrets(error?.message ?? 'Unexpected error') });
      } else {
        res.end();
      }
    });
  });
  server.on('close', () => {
    browserManager.closeSync();
    processManager.stopAllSync();
    const preview = previewServer;
    previewServer = null;
    previewOwner = '';
    void preview?.close();
  });
  return server;
}

/**
 * Windows hands out paths in whatever case the shell and the 8.3 aliases use,
 * so a plain string compare can decide "this is not the main module" and the app
 * exits silently without starting. Compare canonical, case-folded paths.
 */
function samePath(left, right) {
  try {
    const canonical = (value) => {
      const real = fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
      return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    return canonical(left) === canonical(right);
  } catch {
    return false;
  }
}

// A single-executable build has no script path in argv, so ask Node itself.
let seaBuild = false;
try {
  const sea = await import('node:sea');
  seaBuild = typeof sea.isSea === 'function' && sea.isSea();
} catch {
  /* plain node checkout */
}

const binaryName = () => (seaBuild ? path.basename(process.execPath) : 'node app.mjs');
let isMain = seaBuild || Boolean(process.argv[1] && samePath(process.argv[1], import.meta.filename));

if (isMain) {
  if (cli.help) {
    printHelp();
    process.exit(0);
  }
  if (cli.version) {
    console.log(VERSION);
    process.exit(0);
  }
  if (cli.doctor) {
    process.exit(await runDoctor());
  }

  const server = createServer();
  // A wildcard bind is not something a browser can open, so link to loopback.
  const openHost = HOST === '0.0.0.0' || HOST === '::' ? DEFAULT_HOST : HOST;
  const url = `http://${openHost.includes(':') ? `[${openHost}]` : openHost}:${PORT}`;

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      // Only claim "already running" when this app really answers there; any
      // other program on the port used to get its page opened and then us exit.
      void probeExistingApp(url).then((existing) => {
        if (existing) {
          console.log(`Freeway ${existing.version} is already running at ${url} — opening it.`);
          openBrowser(url);
          setTimeout(() => process.exit(0), 400);
          return;
        }
        console.error(`Port ${PORT} is already used by another program.`);
        console.error('Start it on a free port instead, for example:');
        console.error(`  ${binaryName()} --port ${PORT + 1}`);
        process.exit(1);
      });
      return;
    }
    console.error('Failed to start:', error.message);
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Freeway ${VERSION}`);
    console.log(`Running at ${url}`);
    console.log(`Config: ${configPath()}`);
    if (!isLoopback(HOST)) {
      console.log(`Listening on ${HOST}:${PORT} — reachable from other devices on your network.`);
      console.log('There is no password: anyone who can reach this port can use your OpenRouter key.');
    }
    console.log('Close this window to stop the app.');
    openBrowser(url);
  });
}
