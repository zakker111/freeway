#!/usr/bin/env node
// Browser-level regression test for the desktop page at phone size.
//
//   CHROME_BIN=/path/to/chrome npm run test:desktop-390
//
// 2.38.3 shipped a queue, a Stop hold and phone-size notices, but nothing in
// CI rendered the packaged desktop page at 390px: a layout or composer bug
// could ship green. This boots the real app, opens its page at 390x844, and
// drives a turn end to end — the version badge comes from the app's own
// /api/config, only the provider calls are replaced in the page.
//
// Like the other UI tests it speaks the Chrome DevTools Protocol instead of
// adding a browser-automation dependency, and it skips (exit 0) when Chrome is
// not installed.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluate as evaluatePage, findChrome, freePort, launchChrome, sleep, waitForJson, waitForPage } from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = findChrome();
if (!chromeBin) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
}

const WIDTH = 390;
const HEIGHT = 844;
const MODEL = 'mock/free-one';
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

// Installed before the page runs. /api/config is left alone so the badge and the
// edition come from the app; everything else is answered here, and no provider
// is ever called.
function installHarness(model) {
  const realFetch = window.fetch.bind(window);
  const harness = (window.__h = { calls: 0, mode: 'ok', asked: [] });
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const sse = (frames) =>
    new Response(frames.map((frame) => 'data: ' + JSON.stringify(frame) + '\n\n').join(''), {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' },
    });

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    if (url.pathname === '/api/config') return realFetch(input, init);

    if (url.pathname === '/api/chat') {
      harness.calls += 1;
      try {
        harness.asked.push(JSON.parse(String(init.body || '{}')).message);
      } catch {
        harness.asked.push('');
      }
      if (harness.mode === 'hold') {
        const signal = init.signal || input?.signal || null;
        await new Promise((resolve) => {
          if (signal) signal.addEventListener('abort', () => resolve('aborted'), { once: true });
        });
        throw new DOMException('Aborted', 'AbortError');
      }
      const text = `Desktop answer ${harness.calls}.`;
      return sse([
        { type: 'meta', chain: [model] },
        { type: 'delta', delta: text, text },
        { type: 'done', done: true, model, ms: 4, usage: { prompt_tokens: 3, completion_tokens: 4 } },
      ]);
    }

    if (url.pathname === '/api/models') {
      return json({
        provider: 'ovh',
        tier: 'free-tier',
        models: [{ id: model, name: 'Mock Free One', vendor: 'mock', context: 128_000, free: true, tools: true }],
      });
    }
    if (url.pathname === '/api/providers') return json({ provider: 'ovh', providers: [] });
    if (url.pathname === '/api/quota') {
      return json({ ok: true, freeDaily: 50, usage: 0, limitRemaining: 50, isFreeTier: true, source: 'server' });
    }
    if (url.pathname === '/api/budget') return json({ active: false, limit: 40, used: 0, remaining: 40 });
    if (url.pathname === '/api/threads') return json({ threads: [] });
    if (url.pathname === '/api/processes') return json({ processes: [] });
    if (url.pathname === '/api/status') {
      return json({ summary: { requests: 0, ok: 0, successRate: 0, avgMs: null }, recent: [], cooling: [] });
    }
    return json({ ok: true });
  };
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-desktop390-'));
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'notes.md'), '# Notes\n\nA file so the workspace is not empty.\n');
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ workspace }, null, 2));

  let app;
  let chrome;
  let cdp;
  let appLog = '';
  let chromeLog = () => '';
  const results = [];
  const stage = async (name, fn) => {
    try {
      const detail = await fn();
      results.push({ name, ok: true });
      console.log(`  PASS  ${name}${detail ? ' :: ' + JSON.stringify(detail) : ''}`);
    } catch (error) {
      results.push({ name, ok: false });
      console.log(`  FAIL  ${name}`);
      console.log(`        ${error.message}`);
    }
  };

  try {
    const appPort = await freePort();
    app = spawn(
      process.execPath,
      ['app.mjs', '--host', '127.0.0.1', '--port', String(appPort), '--config', config],
      { cwd: root, env: { ...process.env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    app.stdout.on('data', (chunk) => (appLog += chunk));
    app.stderr.on('data', (chunk) => (appLog += chunk));
    const served = await waitForJson(`http://127.0.0.1:${appPort}/api/config`);
    assert.equal(served.version, packageVersion, 'the app does not report the packaged version');

    const browser = await launchChrome({
      chromePath: chromeBin,
      userDataDir: path.join(temp, 'chrome'),
      viewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: true },
      extraArgs: ['--hide-scrollbars'],
    });
    chrome = browser.chrome;
    cdp = browser.cdp;
    chromeLog = browser.log;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installHarness.toString()})(${JSON.stringify(MODEL)});`,
    });

    const evaluate = (expression) => evaluatePage(cdp, expression);
    const waitFor = (expression, timeoutMs = 20_000) => waitForPage(cdp, expression, timeoutMs);
    const send = async (text) => {
      await evaluate(`(() => {
        const input = document.querySelector('#input');
        input.focus();
        input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return true;
      })()`);
      await sleep(120);
    };
    const bubbles = (role) =>
      `[...document.querySelectorAll('.msg.${role} .bubble')].map((node) => node.textContent)`;

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` });
    await waitFor("Boolean(document.querySelector('#input') && document.querySelector('#sendBtn'))");

    await stage('the page renders at 390x844 and shows the version the app reports', async () => {
      await waitFor(`document.querySelector('#version').textContent.includes(${JSON.stringify('v' + packageVersion)})`);
      const page = await evaluate(`(() => ({
        version: document.querySelector('#version').textContent.trim(),
        width: document.documentElement.scrollWidth,
        composer: Boolean(document.querySelector('#input') && document.querySelector('#sendBtn')),
        stopDisabled: document.querySelector('#stopBtn').disabled,
      }))()`);
      assert.equal(page.version, 'v' + packageVersion, 'the badge does not name the packaged version');
      assert.equal(page.composer, true, 'the composer is missing');
      assert.equal(page.stopDisabled, true, 'Stop is enabled before anything was sent');
      assert.ok(page.width <= WIDTH, `the page overflows at ${WIDTH}px: scrollWidth ${page.width}`);
      return { version: page.version, scrollWidth: page.width };
    });

    await stage('a turn streams and renders its answer at phone size', async () => {
      await evaluate("__h.mode = 'ok'; true");
      await send('hello desktop');
      await waitFor(`${bubbles('assistant')}.some((text) => text.includes('Desktop answer 1'))`);
      const state = await evaluate(`(() => ({
        calls: __h.calls,
        asked: ${bubbles('user')},
        answers: ${bubbles('assistant')},
        busy: document.querySelector('#stopBtn').disabled === false,
        width: document.documentElement.scrollWidth,
      }))()`);
      assert.equal(state.calls, 1, `expected one chat request, saw ${state.calls}`);
      assert.ok(state.asked.some((text) => text.includes('hello desktop')), 'the question is not shown');
      assert.ok(state.answers.some((text) => text.includes('Desktop answer 1')), 'the answer is not shown');
      assert.equal(state.busy, false, 'the turn never finished');
      assert.ok(state.width <= WIDTH, `the answer overflows at ${WIDTH}px: scrollWidth ${state.width}`);
      return { calls: state.calls, scrollWidth: state.width };
    });

    await stage('Stop aborts the turn and the next send still works', async () => {
      await evaluate("__h.mode = 'hold'; true");
      await send('stop me');
      await waitFor("document.querySelector('#stopBtn').disabled === false");
      await evaluate("document.querySelector('#stopBtn').click(); true");
      await waitFor("document.querySelector('#stopBtn').disabled === true");
      const stopped = await evaluate(`(() => ({
        answers: ${bubbles('assistant')},
        calls: __h.calls,
        width: document.documentElement.scrollWidth,
      }))()`);
      assert.equal(stopped.calls, 2, 'Stop sent a second request for the same turn');
      assert.ok(
        !stopped.answers.some((text) => text.includes('Desktop answer 2')),
        'the stopped turn still produced an answer',
      );
      assert.ok(stopped.width <= WIDTH, `the stopped turn overflows at ${WIDTH}px: scrollWidth ${stopped.width}`);

      await evaluate("__h.mode = 'ok'; true");
      await send('still works');
      await waitFor(`${bubbles('assistant')}.some((text) => text.includes('Desktop answer 3'))`);
      const after = await evaluate(`({ calls: __h.calls, width: document.documentElement.scrollWidth })`);
      assert.equal(after.calls, 3, `expected a third chat request, saw ${after.calls}`);
      assert.ok(after.width <= WIDTH, `the page overflows after Stop at ${WIDTH}px: scrollWidth ${after.width}`);
      return { calls: after.calls, scrollWidth: after.width };
    });
  } catch (error) {
    console.error('FAIL browser desktop 390:', error.message);
    results.push({ name: 'harness', ok: false });
  } finally {
    cdp?.close();
    chrome?.kill('SIGTERM');
    app?.kill('SIGTERM');
    await sleep(200);
    fs.rmSync(temp, { recursive: true, force: true });
  }

  const failed = results.filter((result) => !result.ok);
  if (failed.length) {
    if (appLog) console.error('App log:', appLog.trim().split('\n').slice(-8).join('\n'));
    if (chromeLog()) console.error('Chrome log:', chromeLog().trim().split('\n').slice(-8).join('\n'));
    console.error(`FAIL browser desktop 390: ${results.length - failed.length}/${results.length} stages passed.`);
    process.exitCode = 1;
  } else {
    console.log(
      `PASS browser desktop 390: the page fits, render ${packageVersion}, streams a turn, and Stop cancels it.`,
    );
  }
}

await main();
