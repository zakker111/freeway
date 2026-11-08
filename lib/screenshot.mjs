// Headless Edge/Chrome capture for the desktop Build loop.
//
// No dependency and no remote service: the browser is a local program, the
// page is the loopback preview server, and the PNG never goes anywhere except
// the model the user already chose. The child gets a filtered environment so a
// provider key cannot be inherited by a browser process.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { MAX_IMAGE_CHARS, supportsVision } from './models.mjs';

const SCREENSHOT_WIDTH = 800;
const SCREENSHOT_HEIGHT = 600;
const SCREENSHOT_TIMEOUT_MS = 20_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// A browser needs a display/temp/profile location, but it never needs the app's
// credentials or the rest of the user's shell environment.
const BROWSER_ENV_KEEP = [
  'PATH',
  'Path',
  'HOME',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SystemRoot',
  'windir',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'TZ',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XAUTHORITY',
  'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'ProgramData',
];

export const screenshotLimits = {
  width: SCREENSHOT_WIDTH,
  height: SCREENSHOT_HEIGHT,
  timeoutMs: SCREENSHOT_TIMEOUT_MS,
  maxChars: MAX_IMAGE_CHARS,
};

/**
 * One place decides whether a screenshot can be offered. A retry may land on
 * any model in the chain, so *every* member must accept images, not just the
 * leading one. Off, Plan, a non-OpenRouter provider, a missing workspace or a
 * non-vision model are all explicit false, never an optimistic true.
 */
export function screenshotAllowed({
  mode = 'build',
  enabled = true,
  toolsOffered = true,
  toolsSupported = true,
  workspaceReady = true,
  providerId = 'openrouter',
  chain = [],
  models = [],
} = {}) {
  if (mode !== 'build' || enabled === false || !toolsOffered || !toolsSupported || !workspaceReady) {
    return false;
  }
  if (providerId !== 'openrouter' || !Array.isArray(chain) || chain.length === 0) return false;
  return chain.every((id) => {
    const model = Array.isArray(models) ? models.find((item) => item?.id === id) : null;
    return Boolean(model && supportsVision(model));
  });
}

function addCandidate(list, value) {
  if (typeof value !== 'string' || !value.trim()) return;
  if (!list.includes(value)) list.push(value);
}

function pathNames(platform) {
  return platform === 'win32'
    ? ['msedge.exe', 'chrome.exe']
    : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge', 'chrome'];
}

/**
 * Installed browser paths, in preference order. `exists` is injectable so the
 * candidate list can be tested without having Edge or Chrome installed.
 */
export function browserCandidates({
  platform = process.platform,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  const candidates = [];
  addCandidate(candidates, env.FREEWAY_BROWSER);

  if (platform === 'win32') {
    const bases = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter(Boolean);
    for (const base of bases) {
      addCandidate(candidates, path.win32.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
      addCandidate(candidates, path.win32.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (platform === 'darwin') {
    for (const base of [env.HOME ? path.join(env.HOME, 'Applications') : null, '/Applications']) {
      if (!base) continue;
      addCandidate(candidates, path.join(base, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
      addCandidate(candidates, path.join(base, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'));
    }
  } else {
    for (const file of [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/opt/google/chrome/chrome',
      '/usr/bin/microsoft-edge',
    ]) {
      addCandidate(candidates, file);
    }
  }

  const delimiter = platform === 'win32' ? path.win32.delimiter : path.delimiter;
  for (const dir of String(env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean)) {
    for (const name of pathNames(platform)) {
      addCandidate(candidates, platform === 'win32' ? path.win32.join(dir, name) : path.join(dir, name));
    }
  }

  return candidates.filter((candidate) => {
    try {
      return exists(candidate);
    } catch {
      return false;
    }
  });
}

/** The first installed browser, or null with an actionable caller error. */
export function findBrowser(options = {}) {
  return browserCandidates(options)[0] ?? null;
}

/** A filtered child environment: local browser settings, never app secrets. */
export function browserEnv(source = process.env) {
  const env = {};
  for (const key of BROWSER_ENV_KEEP) {
    if (typeof source?.[key] === 'string') env[key] = source[key];
  }
  return env;
}

/** The exact Chromium command line, kept pure for a cheap regression test. */
export function browserArgs({ output, profile, width = SCREENSHOT_WIDTH, height = SCREENSHOT_HEIGHT, url }) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    '--force-device-scale-factor=1',
    '--virtual-time-budget=3000',
    `--screenshot=${output}`,
    url,
  ];
}

/** Read the IHDR dimensions; a browser error page is not a usable screenshot. */
export function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  if (width > 20_000 || height > 20_000) return null;
  return { width, height };
}

function runBrowser({ browser, args, timeoutMs, spawn, fsImpl, env, cwd }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(browser, args, {
        cwd,
        env: browserEnv(env),
        stdio: 'ignore',
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let timer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    timer = setTimeout(() => {
      try {
        child.kill?.('SIGKILL');
      } catch {
        /* the browser has already gone */
      }
      finish(
        new Error(
          `The browser did not finish the screenshot within ${Math.round(timeoutMs / 1000)} seconds.`,
        ),
      );
    }, Math.max(100, timeoutMs));
    timer.unref?.();

    child.once?.('error', (error) => finish(error));
    child.once?.('close', (code, signal) => {
      if (settled) return;
      if (code === 0) finish();
      else finish(new Error(`The browser closed before taking a screenshot (${code ?? signal ?? 'unknown'}).`));
    });

    // A fake child in tests may not implement events; real spawn does.
    if (typeof child.once !== 'function') finish(new Error('The browser could not be started.'));
  });
}

/**
 * Capture one local preview as a PNG data URL. The viewport is deliberately
 * small (800×600) so a screenshot fits the same 320 KB image path as a user
 * attachment; no image library is needed.
 */
export async function captureScreenshot({
  url,
  browser,
  width = SCREENSHOT_WIDTH,
  height = SCREENSHOT_HEIGHT,
  timeoutMs = SCREENSHOT_TIMEOUT_MS,
  maxChars = MAX_IMAGE_CHARS,
  spawn = nodeSpawn,
  fsImpl = fs,
  osImpl = os,
  env = process.env,
} = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('The preview address is not a valid URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) {
    throw new Error('Screenshots are limited to the local preview server.');
  }

  const executable = browser === undefined ? findBrowser({ env }) : browser;
  if (!executable) {
    throw new Error(
      'No local Edge or Chrome was found. Install one, or set FREEWAY_BROWSER to its executable path.',
    );
  }

  const dir = fsImpl.mkdtempSync(path.join(osImpl.tmpdir(), 'freeway-shot-'));
  const output = path.join(dir, 'preview.png');
  const profile = path.join(dir, 'profile');
  fsImpl.mkdirSync(profile, { recursive: true });

  try {
    await runBrowser({
      browser: executable,
      args: browserArgs({ output, profile, width, height, url: parsed.href }),
      timeoutMs,
      spawn,
      fsImpl,
      env,
      cwd: dir,
    });
    let buffer;
    try {
      buffer = fsImpl.readFileSync(output);
    } catch {
      throw new Error('The browser did not write a screenshot.');
    }
    const size = pngSize(buffer);
    if (!size) throw new Error('The browser produced an image that is not a readable PNG.');
    const image = `data:image/png;base64,${buffer.toString('base64')}`;
    if (image.length > maxChars) {
      throw new Error(
        `The screenshot is too large to send (${Math.round(image.length / 1024)} KB). ` +
          'Make the page simpler or check its layout with preview_check instead.',
      );
    }
    return { image, width: size.width, height: size.height, bytes: buffer.length };
  } finally {
    try {
      fsImpl.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* a profile lock must not hide the real screenshot error */
    }
  }
}
