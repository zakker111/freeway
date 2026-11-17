// Shared Chrome and DevTools plumbing for the browser UI tests.
//
// ui-preview.mjs, ui-cooldown.mjs, ui-chatty.mjs, ui-desktop-390.mjs and
// ui-store-warning.mjs each
// carried their own copy of this: find Chrome, pick a free port, wait for the
// DevTools endpoint, connect, enable the domains and poll the page. The copies
// had already drifted — only one waited with a connect timeout, only one
// retried the launch — so a fix to one was a fix to one. They share this file
// now; each test keeps its own scenarios, assertions and PASS/FAIL lines.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

/** The first Chrome/Chromium that exists, or '' so the caller can skip. */
export function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next location */
    }
  }
  return '';
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function waitForHttp(url, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      /* not listening yet */
    }
    await sleep(120);
  }
  throw new Error(`timed out waiting for ${url}`);
}

export async function waitForJson(url, timeoutMs = 12_000) {
  return (await waitForHttp(url, timeoutMs)).json();
}

/**
 * A DevTools connection. `onEvent` sees every message the protocol pushes
 * unprompted (console entries, exceptions, lifecycle events).
 */
export function connectCdp(url, onEvent = () => {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let seq = 0;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timed out connecting to ${url}`));
    }, timeoutMs);

    ws.onerror = (event) => {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket failed: ${event.message || 'unknown'}`));
    };
    ws.onopen = () => {
      clearTimeout(timer);
      resolve({
        send(method, params = {}) {
          const id = ++seq;
          return new Promise((resolveMessage, rejectMessage) => {
            const commandTimer = setTimeout(() => {
              pending.delete(id);
              rejectMessage(new Error(`CDP ${method} timed out`));
            }, 15_000);
            pending.set(id, {
              resolve(value) {
                clearTimeout(commandTimer);
                resolveMessage(value);
              },
              reject(error) {
                clearTimeout(commandTimer);
                rejectMessage(error);
              },
            });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() {
          ws.close();
        },
      });
    };
    ws.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message.id) {
        onEvent(message);
        return;
      }
      if (!pending.has(message.id)) return;
      const job = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) job.reject(new Error(message.error.message || 'CDP error'));
      else job.resolve(message.result);
    };
  });
}

export async function waitForPage(cdp, expression, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'page evaluation failed');
    }
    if (result.result?.value) return result.result.value;
    await sleep(100);
  }
  throw new Error(`timed out waiting for: ${expression}`);
}

export async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'page evaluation failed');
  }
  return result.result?.value;
}

/**
 * Launch headless Chrome on a free port, connect to its page target, and enable
 * the Page and Runtime domains. `onStep` is called with 'devtools', 'cdp',
 * 'page' and 'runtime' so a test can print its own progress lines; a failure
 * carries the tail of Chrome's stderr.
 */
export async function launchChrome({
  chromePath = findChrome(),
  userDataDir,
  viewport = null,
  extraArgs = [],
  onEvent,
  timeoutMs = 12_000,
  onStep = () => {},
}) {
  const debugPort = await freePort();
  let log = '';
  const chrome = spawn(
    chromePath,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${userDataDir}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], env: process.env },
  );
  chrome.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, timeoutMs);
    onStep('devtools');
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find((entry) => entry.type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome did not expose a page target');
    const cdp = await connectCdp(target.webSocketDebuggerUrl, onEvent);
    onStep('cdp');
    await cdp.send('Page.enable');
    onStep('page');
    await cdp.send('Runtime.enable');
    onStep('runtime');
    if (viewport) await cdp.send('Emulation.setDeviceMetricsOverride', viewport);
    return { chrome, cdp, log: () => log };
  } catch (error) {
    chrome.kill('SIGTERM');
    throw new Error(`${error.message}\nChrome log:\n${log.slice(-2000)}`);
  }
}
