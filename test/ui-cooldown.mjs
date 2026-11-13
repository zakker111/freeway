#!/usr/bin/env node
// Browser-level regression test for the cooldown retry paths.
//
//   CHROME_BIN=/path/to/chrome npm run test:cooldown
//
// The app has no browser-automation dependency, so this uses the Chrome
// DevTools Protocol like test/ui-preview.mjs. The desktop page is served by the
// real app; the cloud page is served statically. Only /api/* is replaced in the
// page, which lets the test force a 429 before the success response and count
// every chat request. A regression that adds a second automatic resend fails
// here even though the unit-level predicate tests still pass.
//
// A cooldown is deliberately short (1.2s provider delay + the page's 0.75s
// cushion). The check also asserts that the second request did not leave early.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = findChrome();

if (!chromeBin) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
}

const RETRY_AFTER_MS = 1200;
// The tool-mode 429 also sends `retry-after: 2`, so settle past the longest
// mocked cooldown (2s + the page's 0.75s cushion) before counting requests.
const RETRY_SETTLE_MS = Math.ceil(RETRY_AFTER_MS / 1000) * 1000 + 750 + 250;
const CLOUD_PUBLIC = path.join(root, 'cloud', 'public');

const PAGE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function findChrome() {
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitForHttp(url, timeoutMs = 12_000) {
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

async function waitForJson(url, timeoutMs = 12_000) {
  return (await waitForHttp(url, timeoutMs)).json();
}

function connectCdp(url, onEvent = () => {}, timeoutMs = 10_000) {
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
            const timer = setTimeout(() => {
              pending.delete(id);
              rejectMessage(new Error(`CDP ${method} timed out`));
            }, 15_000);
            pending.set(id, {
              resolve(value) {
                clearTimeout(timer);
                resolveMessage(value);
              },
              reject(error) {
                clearTimeout(timer);
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

async function waitForPage(cdp, expression, timeoutMs = 12_000) {
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

async function evaluate(cdp, expression) {
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

// This function is serialized into the page before the app boots. Keeping it
// self-contained makes the mocked API identical for both editions.
function installHarness(config) {
  const realFetch = window.fetch.bind(window);
  const harness = {
    calls: [],
    mode: 'stream',
    scenario: 'retry-success',
  };
  window.__cooldownHarness = harness;

  function json(body, status = 200, headers = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    });
  }

  function sse(frames) {
    return new Response(
      frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
      {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
        },
      },
    );
  }

  function limited() {
    if (harness.mode === 'tool') {
      return json(
        {
          error: 'rate-limit',
          message: 'Mock rate limit',
          retryAfterMs: config.retryAfterMs,
          model: 'mock/free-one',
        },
        429,
        { 'retry-after': String(Math.ceil(config.retryAfterMs / 1000)) },
      );
    }
    // Both stream clients understand these fields: desktop uses type/reason,
    // cloud uses the error event and retryAfterMs.
    return sse([
      {
        type: 'error',
        error: 'rate-limit',
        reason: 'rate-limit',
        message: 'Mock rate limit',
        retryAfterMs: config.retryAfterMs,
      },
    ]);
  }

  function recovered() {
    if (harness.mode === 'tool') {
      return json({
        text: 'Recovered tool answer.',
        provider: 'openrouter',
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      });
    }
    return sse([
      { type: 'meta', chain: ['mock/free-one'] },
      { type: 'delta', delta: 'Recovered answer.', text: 'Recovered answer.' },
      {
        type: 'done',
        done: true,
        model: 'mock/free-one',
        ms: 4,
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      },
    ]);
  }

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);

    const method = String(init.method || input?.method || 'GET').toUpperCase();

    if (url.pathname === '/api/chat') {
      const call = { at: Date.now(), body: null };
      try {
        call.body = JSON.parse(String(init.body || '{}'));
      } catch {
        /* only the count matters */
      }
      harness.calls.push(call);
      if (harness.scenario === 'retry-error' || harness.calls.length === 1) return limited();
      return recovered();
    }

    if (url.pathname === '/api/config') {
      return json({
        version: config.version,
        edition: 'browser-test',
        hasKey: true,
        requiresAccount: false,
        hasAccount: true,
        provider: 'openrouter',
        workspace: config.workspace,
        settings: config.settings,
        providers: config.providers,
        serverKeys: ['openrouter'],
        defaultProvider: 'openrouter',
        desktopDownloadUrl: 'https://github.com/zakker111/freeway/releases/latest',
        guard: { deploymentKey: true, perVisitorPerDay: 40, turnTokens: 1024, originFence: true },
      });
    }

    if (url.pathname === '/api/providers') {
      return json({ provider: 'openrouter', providers: config.providers });
    }

    if (url.pathname === '/api/models') {
      return json({
        provider: 'openrouter',
        tier: 'verified',
        models: [{ id: 'mock/free-one', name: 'Mock Free One', context_length: 128_000 }],
      });
    }

    if (url.pathname === '/api/quota') {
      return json({
        ok: true,
        freeDaily: 50,
        usage: 0,
        limitRemaining: 50,
        isFreeTier: true,
        source: 'server',
      });
    }

    if (url.pathname === '/api/budget') {
      return json({ active: false, limit: 40, used: 0, remaining: 40 });
    }

    if (url.pathname === '/api/threads') {
      return method === 'GET' ? json({ threads: [] }) : json({ ok: true });
    }

    if (url.pathname === '/api/processes') return json({ processes: [] });
    if (url.pathname === '/api/status') {
      return json({
        summary: { requests: 0, ok: 0, successRate: 0, avgMs: null },
        recent: [],
        cooling: [],
      });
    }
    if (url.pathname === '/api/session/reset') return json({ ok: true });

    return json({ ok: true });
  };

  const params = new URLSearchParams(location.search);
  harness.mode = params.get('harness') === 'tool' ? 'tool' : 'stream';
}

function startCloudServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      let relative = decodeURIComponent(url.pathname);
      if (relative === '/' || relative.endsWith('/')) relative += 'index.html';
      const file = path.resolve(CLOUD_PUBLIC, '.' + relative);
      if (!file.startsWith(CLOUD_PUBLIC + path.sep)) throw new Error('outside');
      const body = await fs.promises.readFile(file);
      res.writeHead(200, {
        'content-type': PAGE_TYPES[path.extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
    }
  });
  return server;
}

async function startDesktopApp(temp) {
  const port = await freePort();
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ workspace }, null, 2));
  let log = '';
  const app = spawn(
    process.execPath,
    ['app.mjs', '--host', '127.0.0.1', '--port', String(port), '--config', config],
    {
      cwd: root,
      env: { ...process.env, NO_OPEN: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  app.stdout.on('data', (chunk) => (log += chunk));
  app.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForHttp(`http://127.0.0.1:${port}/api/config`);
  } catch (error) {
    app.kill('SIGTERM');
    throw new Error(`${error.message}\nApp log:\n${log.slice(-2000)}`);
  }
  return { app, port, log: () => log };
}

async function startChrome(temp, onEvent) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await launchChrome(temp, onEvent, attempt === 1 ? 12_000 : 25_000);
    } catch (error) {
      lastError = error;
      console.log('Chrome launch attempt ' + attempt + ' failed: ' + error.message.split('\n')[0]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw lastError;
}

async function launchChrome(temp, onEvent, devtoolsTimeoutMs) {
  const debugPort = await freePort();
  let log = '';
  const chrome = spawn(
    chromeBin,
    [
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--remote-allow-origins=*',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${path.join(temp, 'chrome')}`,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'], env: process.env },
  );
  chrome.stderr.on('data', (chunk) => (log += chunk));
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, devtoolsTimeoutMs);
    console.log('Chrome DevTools is listening.');
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find((entry) => entry.type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome did not expose a page target');
    const cdp = await connectCdp(target.webSocketDebuggerUrl, onEvent);
    console.log('CDP page connected.');
    await cdp.send('Page.enable');
    console.log('Page domain enabled.');
    await cdp.send('Runtime.enable');
    console.log('Runtime domain enabled.');
    return { chrome, cdp, log: () => log };
  } catch (error) {
    chrome.kill('SIGTERM');
    throw new Error(`${error.message}\nChrome log:\n${log.slice(-2000)}`);
  }
}

async function openPage(browser, baseUrl, edition, mode = 'stream') {
  const { cdp } = browser;
  await cdp.send('Storage.clearDataForOrigin', {
    origin: new URL(baseUrl).origin,
    storageTypes: 'all',
  });
  console.log('Navigating ' + edition + '...');
  await cdp.send('Page.navigate', {
    url: `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}harness=${mode}`,
  });
  await waitForPage(
    cdp,
    'document.readyState === "complete" && /mock\\/free-one|Mock Free One/i.test(document.querySelector("#modelBtn")?.textContent || "")',
    15_000,
  );
  const sendSelector = edition === 'desktop' ? '#sendBtn' : '#send';
  await evaluate(
    cdp,
    `(() => {
      const input = document.querySelector('#input');
      const send = document.querySelector(${JSON.stringify(sendSelector)});
      if (!input || !send) throw new Error('composer missing');
      return true;
    })()`,
  );
}

async function setScenario(browser, scenario) {
  await evaluate(
    browser.cdp,
    `window.__cooldownHarness.scenario = ${JSON.stringify(scenario)}; true`,
  );
}

async function enableCloudTools(browser) {
  const { cdp } = browser;
  await evaluate(cdp, 'document.querySelector("#settingsBtn").click(); true');
  await waitForPage(cdp, 'document.querySelector("#settingsDialog").open === true');
  await evaluate(cdp, 'document.querySelector("#settingTools").checked = true; true');
  await evaluate(cdp, 'document.querySelector("#settingsSave").click(); true');
  await waitForPage(cdp, 'document.querySelector("#settingsDialog").open === false');
  await evaluate(cdp, 'document.querySelector("#modeBuild").click(); true');
}

async function send(browser, edition, text) {
  const sendSelector = edition === 'desktop' ? '#sendBtn' : '#send';
  await evaluate(
    browser.cdp,
    `(() => {
      const input = document.querySelector('#input');
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector(${JSON.stringify(sendSelector)}).click();
      return true;
    })()`,
  );
}

async function calls(browser) {
  return evaluate(
    browser.cdp,
    'window.__cooldownHarness.calls.map((call) => ({ at: call.at, body: call.body }))',
  );
}

function coolingSnapshotExpression() {
  return `(() => {
    const thread = document.querySelector('#thread');
    return {
      text: thread ? thread.innerText : '',
      cooling: document.querySelectorAll('.cooling').length,
    };
  })()`;
}

async function runRetrySuccess(browser, edition, mode = 'stream') {
  await setScenario(browser, 'retry-success');
  if (edition === 'cloud' && mode === 'tool') await enableCloudTools(browser);
  await send(browser, edition, 'Please retry this.');
  await waitForPage(
    browser.cdp,
    `document.querySelector('#thread').innerText.includes('Cooling down')`,
    6000,
  );
  const cooling = await evaluate(browser.cdp, coolingSnapshotExpression());
  assert.match(cooling.text, /Cooling down/, 'the cooldown countdown was not rendered');
  assert.match(cooling.text, /retrying in \d+s/i, 'the countdown did not show seconds');
  assert.ok(cooling.cooling > 0, 'the cooling class was not applied to the pending answer');

  const sendSelector = edition === 'desktop' ? '#sendBtn' : '#send';
  await waitForPage(
    browser.cdp,
    `window.__cooldownHarness.calls.length === 2 && !document.querySelector(${JSON.stringify(sendSelector)}).disabled`,
    10_000,
  );
  await waitForPage(
    browser.cdp,
    `document.querySelector('#thread').innerText.includes(${JSON.stringify(
      mode === 'tool' ? 'Recovered tool answer.' : 'Recovered answer.',
    )})`,
    6000,
  );
  // Wait through another full cooldown window so a delayed duplicate resend
  // cannot slip in after the assertions below.
  await sleep(RETRY_SETTLE_MS);

  const requests = await calls(browser);
  assert.equal(requests.length, 2, 'the turn did not make exactly one automatic resend');
  assert.ok(
    requests[1].at - requests[0].at >= RETRY_AFTER_MS,
    `the resend fired after ${requests[1].at - requests[0].at}ms, before the provider delay`,
  );
  assert.equal(await evaluate(browser.cdp, 'document.querySelectorAll(".cooling").length'), 0);
  return requests;
}

async function runRetryStops(browser, edition) {
  await setScenario(browser, 'retry-error');
  await send(browser, edition, 'Do not loop forever.');
  await waitForPage(
    browser.cdp,
    `document.querySelector('#thread').innerText.includes('Cooling down')`,
    6000,
  );
  const sendSelector = edition === 'desktop' ? '#sendBtn' : '#send';
  await waitForPage(
    browser.cdp,
    `window.__cooldownHarness.calls.length === 2 && !document.querySelector(${JSON.stringify(sendSelector)}).disabled`,
    10_000,
  );
  await waitForPage(
    browser.cdp,
    `document.querySelector('#thread').innerText.includes('Mock rate limit')`,
    6000,
  );
  // A second automatic resend would be scheduled after this cooldown. Wait it
  // out so this assertion covers the full retry window, not just the first turn.
  await sleep(RETRY_SETTLE_MS);
  const requests = await calls(browser);
  assert.equal(requests.length, 2, 'a repeated 429 triggered more than one automatic resend');
  assert.equal(await evaluate(browser.cdp, 'document.querySelectorAll(".cooling").length'), 0);
  assert.match(
    await evaluate(browser.cdp, 'document.querySelector("#thread").innerText'),
    /Mock rate limit/,
  );
  return requests;
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-cooldown-'));
  let app;
  let cloudServer;
  let chrome;
  let cdp;
  let appLog = () => '';
  let chromeLog = () => '';
  const pageErrors = [];
  const results = [];

  async function check(name, fn) {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log('  PASS  ' + name);
    } catch (error) {
      results.push({ name, ok: false, error });
      console.log('  FAIL  ' + name);
      console.log('        ' + (error?.stack || error?.message || error));
    }
  }

  try {
    console.log('Starting desktop and cloud pages...');
    const started = await startDesktopApp(temp);
    app = started.app;
    appLog = started.log;
    cloudServer = startCloudServer();
    await new Promise((resolve, reject) => {
      cloudServer.once('error', reject);
      cloudServer.listen(0, '127.0.0.1', resolve);
    });
    const cloudPort = cloudServer.address().port;
    console.log('Starting headless Chrome...');
    const browser = await startChrome(temp, (message) => {
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails;
        pageErrors.push(details?.exception?.description || details?.text || 'page exception');
      }
    });
    chrome = browser.chrome;
    chromeLog = browser.log;
    cdp = browser.cdp;

    console.log('Installing the browser harness...');
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installHarness.toString()})(${JSON.stringify({
        retryAfterMs: RETRY_AFTER_MS,
        version: '2.22.3',
        workspace: path.join(temp, 'workspace'),
        providers: [
          {
            id: 'openrouter',
            label: 'OpenRouter',
            keyHint: 'sk-or-v1-…',
            keysUrl: 'https://openrouter.ai/settings/keys',
            tier: 'verified',
            planLabel: 'free · always',
            limitLines: ['Mocked for the browser test.'],
            note: 'Free models only.',
            hasKey: true,
            requiresAccount: false,
            hasAccount: true,
            anonymous: false,
            local: false,
            freePolicy: 'pricing',
          },
        ],
        settings: {
          system: '',
          maxTokens: 1024,
          temperature: null,
          tools: false,
          autoApprove: false,
          screenshotChecks: false,
          allowCommands: false,
          commandAllowlist: [],
        },
      })})`,
    });

    const browserInfo = { cdp, chrome };

    await check('desktop: cooldown shows a countdown and resends exactly once', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${started.port}/`, 'desktop');
      await runRetrySuccess(browserInfo, 'desktop');
    });

    await check('desktop: a repeated 429 stops after one automatic resend', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${started.port}/`, 'desktop');
      await runRetryStops(browserInfo, 'desktop');
    });

    await check('cloud stream: cooldown shows a countdown and resends exactly once', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${cloudPort}/`, 'cloud');
      await runRetrySuccess(browserInfo, 'cloud');
    });

    await check('cloud stream: a repeated 429 stops after one automatic resend', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${cloudPort}/`, 'cloud');
      await runRetryStops(browserInfo, 'cloud');
    });

    await check('cloud tools: cooldown shows a countdown and resends exactly once', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${cloudPort}/`, 'cloud', 'tool');
      await runRetrySuccess(browserInfo, 'cloud', 'tool');
    });
  } catch (error) {
    console.error('FAIL browser cooldown harness:', error.stack || error.message);
    console.error('App exit:', app?.exitCode);
    console.error('Chrome exit:', chrome?.exitCode);
    console.error('App log:', appLog().slice(-4000));
    console.error('Chrome log:', chromeLog().slice(-4000));
    process.exitCode = 1;
  } finally {
    cdp?.close();
    chrome?.kill('SIGTERM');
    app?.kill('SIGTERM');
    if (cloudServer) await new Promise((resolve) => cloudServer.close(resolve));
    await sleep(200);
    fs.rmSync(temp, { recursive: true, force: true });
  }

  if (pageErrors.length) {
    console.log('\nPAGE ERRORS:');
    for (const error of pageErrors) console.log('  ' + error);
  }

  const failed = results.filter((result) => !result.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser cooldown checks passed`);
  if (failed || pageErrors.length) process.exitCode = 1;
}

await main();
