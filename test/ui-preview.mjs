#!/usr/bin/env node
// Browser-level preview regression test.
//
//   CHROME_BIN=/path/to/chrome npm run test:ui
//
// This deliberately uses the Chrome DevTools Protocol instead of a browser
// automation package: the app has no runtime dependencies and the UI test
// should not add one. The app is started on a free loopback port with a
// temporary workspace, then the real Files and Preview controls are clicked.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = process.env.CHROME_BIN;
if (!chromeBin || !fs.existsSync(chromeBin)) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
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
  const response = await waitForHttp(url, timeoutMs);
  return response.json();
}

function connectCdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let seq = 0;

    ws.onerror = (event) => reject(new Error(`CDP WebSocket failed: ${event.message || 'unknown'}`));
    ws.onopen = () => {
      resolve({
        send(method, params = {}) {
          const id = ++seq;
          return new Promise((resolveMessage, rejectMessage) => {
            pending.set(id, { resolve: resolveMessage, reject: rejectMessage });
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
      if (!message.id || !pending.has(message.id)) return;
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

function clickRow(name) {
  return `(() => {
    const row = [...document.querySelectorAll('.fs-row')]
      .find((node) => node.textContent.includes(${JSON.stringify(name)}));
    if (!row) return false;
    row.click();
    return true;
  })()`;
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-ui-'));
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(
    path.join(workspace, 'phase3-demo.md'),
    '# Phase 3 Markdown\n\nThis is rendered by the shared preview core.\n\n| Check | Result |\n| --- | --- |\n| Headings | yes |\n| Tables | yes |\n\n```js\nconst ready = true;\n```\n',
  );
  fs.writeFileSync(path.join(workspace, 'style.scss'), '$ink: #111;\nbody { color: $ink; }\n');
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ workspace }, null, 2));

  let app;
  let chrome;
  let cdp;
  let appLog = '';
  let chromeLog = '';
  try {
    const appPort = await freePort();
    app = spawn(
      process.execPath,
      ['app.mjs', '--host', '127.0.0.1', '--port', String(appPort), '--config', config],
      {
        cwd: root,
        env: { ...process.env, NO_OPEN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    app.stdout.on('data', (chunk) => (appLog += chunk));
    app.stderr.on('data', (chunk) => (appLog += chunk));
    await waitForHttp(`http://127.0.0.1:${appPort}/api/config`);

    const debugPort = await freePort();
    chrome = spawn(
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
    chrome.stderr.on('data', (chunk) => (chromeLog += chunk));
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
    const targets = await waitForJson(`http://127.0.0.1:${debugPort}/json/list`);
    const target = targets.find((entry) => entry.type === 'page');
    assert.ok(target?.webSocketDebuggerUrl, 'Chrome did not expose a page target');

    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` });
    await waitForPage(cdp, 'document.readyState === "complete" && !!document.querySelector("#railBtn")');

    await evaluate(cdp, 'document.querySelector("#railBtn").click()');
    await waitForPage(cdp, '!![...document.querySelectorAll(".fs-row")].find((node) => node.textContent.includes("style.scss"))');
    assert.equal(await evaluate(cdp, clickRow('style.scss')), true);
    await waitForPage(cdp, 'document.querySelector("#fsFileName").textContent.includes("style.scss")');
    await evaluate(cdp, 'document.querySelector("#fsPreview").click()');
    await waitForPage(cdp, 'document.querySelector("#railPreview").innerText.includes("BUILD_REQUIRED")');

    const scss = await evaluate(
      cdp,
      `(() => {
        const frame = document.querySelector('#pvFrame');
        const error = document.querySelector('#pvError');
        return {
          frameDisplay: getComputedStyle(frame).display,
          cardVisible: !error.hidden && getComputedStyle(error).display !== 'none',
          text: document.querySelector('#railPreview').innerText,
        };
      })()`,
    );
    assert.equal(scss.frameDisplay, 'none', 'BUILD_REQUIRED left the preview frame visible');
    assert.equal(scss.cardVisible, true, 'BUILD_REQUIRED card was not visible');
    assert.match(scss.text, /npx sass style\.scss style\.css/);

    await evaluate(cdp, '[...document.querySelectorAll(".rail-tab")].find((node) => node.textContent.trim() === "Files").click()');
    await waitForPage(cdp, '!![...document.querySelectorAll(".fs-row")].find((node) => node.textContent.includes("phase3-demo.md"))');
    assert.equal(await evaluate(cdp, clickRow('phase3-demo.md')), true);
    await waitForPage(cdp, 'document.querySelector("#fsFileName").textContent.includes("phase3-demo.md")');
    await evaluate(cdp, 'document.querySelector("#fsPreview").click()');
    await waitForPage(cdp, 'document.querySelector("#pvFrame").srcdoc.includes("Phase 3 Markdown")');

    const markdown = await evaluate(
      cdp,
      `(() => {
        const frame = document.querySelector('#pvFrame');
        return {
          frameDisplay: getComputedStyle(frame).display,
          errorHidden: document.querySelector('#pvError').hidden,
          source: frame.srcdoc,
        };
      })()`,
    );
    assert.notEqual(markdown.frameDisplay, 'none', 'Markdown did not reveal the preview frame');
    assert.equal(markdown.errorHidden, true, 'Markdown left the build card visible');
    assert.match(markdown.source, /<h1>Phase 3 Markdown<\/h1>/);
    assert.match(markdown.source, /<table>/);

    await evaluate(cdp, '[...document.querySelectorAll(".rail-tab")].find((node) => node.textContent.trim() === "Files").click()');
    await waitForPage(cdp, '!![...document.querySelectorAll(".fs-row")].find((node) => node.textContent.includes("style.scss"))');
    assert.equal(await evaluate(cdp, clickRow('style.scss')), true);
    await waitForPage(cdp, 'document.querySelector("#fsFileName").textContent.includes("style.scss")');
    await evaluate(cdp, 'document.querySelector("#fsPreview").click()');
    await waitForPage(cdp, 'document.querySelector("#railPreview").innerText.includes("BUILD_REQUIRED")');
    const url = `http://127.0.0.1:${appPort}/api/config`;
    await evaluate(
      cdp,
      `(() => {
        document.querySelector('#pvUrl').value = ${JSON.stringify(url)};
        document.querySelector('#pvLoad').click();
        return true;
      })()`,
    );
    await waitForPage(cdp, `document.querySelector('#pvFrame').getAttribute('src') === ${JSON.stringify(url)}`);
    const urlState = await evaluate(
      cdp,
      `({
        frameDisplay: getComputedStyle(document.querySelector('#pvFrame')).display,
        errorHidden: document.querySelector('#pvError').hidden,
      })`,
    );
    assert.notEqual(urlState.frameDisplay, 'none', 'URL preview did not reveal the frame');
    assert.equal(urlState.errorHidden, true, 'URL preview kept the build card visible');

    console.log('PASS browser preview: SCSS card hides the frame; Markdown and URL restore it.');
  } catch (error) {
    console.error('FAIL browser preview:', error.message);
    if (app?.exitCode === null) console.error('App log:', appLog.trim().split('\n').slice(-8).join('\n'));
    if (chrome?.exitCode === null) console.error('Chrome log:', chromeLog.trim().split('\n').slice(-8).join('\n'));
    process.exitCode = 1;
  } finally {
    cdp?.close();
    chrome?.kill('SIGTERM');
    app?.kill('SIGTERM');
    await sleep(200);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

await main();
