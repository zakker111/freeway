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
import os from 'node:os';
import path from 'node:path';
import { evaluate, findChrome, freePort, launchChrome, sleep, waitForHttp, waitForPage } from './browser.mjs';

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
// Both editions stop after this many attempts at one turn; the page constant
// `SEND_GATE_MAX_ATTEMPTS` must match it or a permanent 429 loops or gives up early.
const RETRY_ATTEMPTS = 4;
const CLOUD_PUBLIC = path.join(root, 'cloud', 'public');

const PAGE_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

// This function is serialized into the page before the app boots. Keeping it
// self-contained makes the mocked API identical for both editions.
function installHarness(config) {
  const realFetch = window.fetch.bind(window);
  const harness = {
    calls: [],
    mode: 'stream',
    scenario: 'retry-success',
    retryAfterMs: config.retryAfterMs,
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
          retryAfterMs: harness.retryAfterMs,
          model: 'mock/free-one',
        },
        429,
        { 'retry-after': String(Math.ceil(harness.retryAfterMs / 1000)) },
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
        retryAfterMs: harness.retryAfterMs,
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

// Two attempts: a cold DevTools endpoint under load can take longer than the
// first window allows, and a retry costs a second rather than the whole run.
const CHROME_STEP_LINES = {
  devtools: 'Chrome DevTools is listening.',
  cdp: 'CDP page connected.',
  page: 'Page domain enabled.',
  runtime: 'Runtime domain enabled.',
};

async function startChrome(temp, onEvent) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return await launchChrome({
        chromePath: chromeBin,
        userDataDir: path.join(temp, 'chrome'),
        onEvent,
        timeoutMs: attempt === 1 ? 12_000 : 25_000,
        onStep: (step) => console.log(CHROME_STEP_LINES[step]),
      });
    } catch (error) {
      lastError = error;
      console.log('Chrome launch attempt ' + attempt + ' failed: ' + error.message.split('\n')[0]);
    }
    await sleep(1_000);
  }
  throw lastError;
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
  // A permanent 429 must stop at the bounded attempt budget instead of looping.
  // Each attempt first shows its own countdown, so the wait scales with it.
  await waitForPage(
    browser.cdp,
    `window.__cooldownHarness.calls.length === ${RETRY_ATTEMPTS}`,
    25_000,
  );
  await waitForPage(
    browser.cdp,
    `document.querySelector('#thread').innerText.includes('Mock rate limit')`,
    6000,
  );
  const chip = await evaluate(
    browser.cdp,
    `(() => {
      const node = document.querySelector('#nextSend');
      return { hidden: !node || node.hidden, text: node ? node.textContent : '' };
    })()`,
  );
  assert.equal(chip.hidden, false, 'the composer did not show when the next send is allowed');
  assert.match(chip.text, /next send in \d+/i, 'the next-send chip did not count down');
  const heldButton = await evaluate(
    browser.cdp,
    `document.querySelector(${JSON.stringify(sendSelector)}).disabled`,
  );
  assert.equal(heldButton, true, 'Send stayed available under an active rate limit');
  // The gate must release the composer by itself once the wait is over.
  await waitForPage(
    browser.cdp,
    `!document.querySelector(${JSON.stringify(sendSelector)}).disabled && document.querySelector('#nextSend').hidden === true`,
    6000,
  );
  // Nothing schedules another attempt: the count stays at the budget.
  await sleep(RETRY_SETTLE_MS);
  const requests = await calls(browser);
  assert.equal(requests.length, RETRY_ATTEMPTS, 'a repeated 429 ran past the bounded attempts');
  assert.equal(await evaluate(browser.cdp, 'document.querySelectorAll(".cooling").length'), 0);
  assert.match(
    await evaluate(browser.cdp, 'document.querySelector("#thread").innerText'),
    /Mock rate limit/,
  );
  return requests;
}

// A message typed while the gate is closed must wait for the timer and then go
// out by itself; Enter must not reach the provider early.
async function runQueuedSend(browser) {
  await setScenario(browser, 'retry-error');
  await send(browser, 'cloud', 'First attempt that gets limited.');
  await waitForPage(
    browser.cdp,
    `window.__cooldownHarness.calls.length === ${RETRY_ATTEMPTS} && document.querySelector('#nextSend') && !document.querySelector('#nextSend').hidden`,
    30_000,
  );
  const before = (await calls(browser)).length;
  assert.equal(before, RETRY_ATTEMPTS, 'the gate opened before the retry budget ran out');

  await evaluate(
    browser.cdp,
    `(() => {
      const input = document.querySelector('#input');
      input.value = 'Second, queued message.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`,
  );
  assert.equal(
    (await calls(browser)).length,
    RETRY_ATTEMPTS,
    'Enter sent the message straight through a closed gate',
  );
  const chip = await evaluate(browser.cdp, 'document.querySelector("#nextSend").textContent');
  assert.match(chip, /1 held/i, 'the held message is not counted in the gate chip');
  assert.equal(
    await evaluate(browser.cdp, 'document.querySelectorAll("#sendQueue .queue-item").length'),
    1,
    'the held message is not listed above the composer',
  );
  assert.match(
    await evaluate(browser.cdp, 'document.querySelector("#bannerSlot").innerText'),
    /held/i,
    'the page never says the message is held',
  );

  await waitForPage(browser.cdp, `window.__cooldownHarness.calls.length === ${RETRY_ATTEMPTS + 1}`, 12_000);
  const requests = await calls(browser);
  const queued = requests[RETRY_ATTEMPTS];
  assert.match(JSON.stringify(queued.body), /Second, queued message/, 'the queued text was not what went out');
  assert.ok(
    queued.at - requests[RETRY_ATTEMPTS - 1].at >= RETRY_AFTER_MS,
    `the queued message left after ${queued.at - requests[RETRY_ATTEMPTS - 1].at}ms, before the wait ended`,
  );
  return requests.length;
}

// The held slot is now a list: both messages show up, the first can be edited,
// the second cancelled, and the gate sends the edited text by itself.
async function runQueue(browser) {
  await evaluate(browser.cdp, 'window.__cooldownHarness.retryAfterMs = 2500; true');
  await setScenario(browser, 'retry-error');
  await send(browser, 'cloud', 'First attempt that gets limited.');
  await waitForPage(
    browser.cdp,
    `window.__cooldownHarness.calls.length === ${RETRY_ATTEMPTS} && document.querySelector('#nextSend') && !document.querySelector('#nextSend').hidden`,
    40_000,
  );

  const hold = async (text) => {
    await evaluate(
      browser.cdp,
      `(() => {
        const input = document.querySelector('#input');
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // The Send button is disabled while the gate is closed, so Enter is the
        // path a person actually has; both go through send().
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`,
    );
  };
  await hold('First held message.');
  await hold('Second held message.');

  const shape = () =>
    evaluate(
      browser.cdp,
      `(() => {
        const list = document.querySelector('#sendQueue');
        const rows = [...document.querySelectorAll('#sendQueue .queue-item')];
        return {
          hidden: list.hidden,
          rows: rows.length,
          values: rows.map((row) => row.querySelector('input').value),
          chip: document.querySelector('#nextSend').textContent,
        };
      })()`,
    );

  let state = await shape();
  assert.equal(state.hidden, false, 'the held-message list stayed hidden');
  assert.equal(state.rows, 2, 'the queue did not hold both messages');
  assert.match(state.chip, /2 held/i, 'the gate chip does not count the queue');

  await evaluate(
    browser.cdp,
    `(() => {
      const input = document.querySelector('#sendQueue .queue-item input');
      input.value = 'First held message, edited.';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`,
  );
  await evaluate(
    browser.cdp,
    `(() => {
      const rows = [...document.querySelectorAll('#sendQueue .queue-item')];
      rows[1].querySelectorAll('button')[1].click();
      return true;
    })()`,
  );
  state = await shape();
  assert.equal(state.rows, 1, 'Cancel did not remove the held message');
  assert.equal(state.values[0], 'First held message, edited.', 'the edit was lost');

  await evaluate(browser.cdp, 'document.querySelector("#sendQueue .queue-item button").click(); true');
  state = await shape();
  assert.equal(state.rows, 1, 'Send now bypassed the closed gate');
  assert.match(
    await evaluate(browser.cdp, 'document.querySelector("#bannerSlot").innerText'),
    /still rate limited/i,
    'Send now said nothing about the wait',
  );

  await waitForPage(browser.cdp, `window.__cooldownHarness.calls.length === ${RETRY_ATTEMPTS + 1}`, 15_000);
  const requests = await calls(browser);
  assert.match(
    JSON.stringify(requests[RETRY_ATTEMPTS].body),
    /First held message, edited\./,
    'the held message went out unedited',
  );
  await waitForPage(browser.cdp, 'document.querySelector("#sendQueue").hidden === true', 8000);
  return { rows: state.rows };
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

    await check('cloud stream: a message typed during the wait is sent when the timer ends', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${cloudPort}/`, 'cloud');
      await runQueuedSend(browserInfo);
    });

    await check('cloud stream: held messages list, edit, cancel, and send on the timer', async () => {
      await openPage(browserInfo, `http://127.0.0.1:${cloudPort}/`, 'cloud');
      await runQueue(browserInfo);
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
