#!/usr/bin/env node
// Browser-level regression test for the store warning banner.
//
//   CHROME_BIN=/path/to/chrome npm run test:store-warning
//
// 2.38.10 made the store warning persist and gave threads-archive.json the same
// quarantine and backup as threads.json, but nothing proved the sidebar banner
// the user actually reads: the store tests assert the payload and the CLI test
// asserts the routes, while a broken renderStoreNote would have shipped green.
// This boots the real app on a genuinely damaged chat store, opens its page and
// checks the banner names both problems, then dismisses it and reloads.
//
// Only provider traffic is replaced in the page: /api/config and every
// /api/threads route go to the real app, so the warning and its dismissal are
// the ones the store produced. It skips (exit 0) when Chrome is not installed.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  evaluate as evaluatePage,
  findChrome,
  freePort,
  launchChrome,
  sleep,
  waitForJson,
  waitForPage,
} from './browser.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromeBin = findChrome();
if (!chromeBin) {
  console.error('SKIP: set CHROME_BIN to a Chrome or Chromium executable to run this test.');
  process.exit(0);
}

// Everything except the chat store is answered here; no provider is ever called.
function installHarness() {
  const realFetch = window.fetch.bind(window);
  const json = (body) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  window.fetch = async (input, init = {}) => {
    const raw = typeof input === 'string' ? input : input?.url;
    const url = new URL(raw, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    // The warning under test comes from the real store, and so does Dismiss.
    if (url.pathname === '/api/config' || url.pathname.startsWith('/api/threads')) {
      return realFetch(input, init);
    }

    if (url.pathname === '/api/models') {
      return json({
        provider: 'ovh',
        tier: 'free-tier',
        models: [
          { id: 'mock/free-one', name: 'Mock Free One', vendor: 'mock', context: 128_000, free: true, tools: true },
        ],
      });
    }
    if (url.pathname === '/api/providers') return json({ provider: 'ovh', providers: [] });
    if (url.pathname === '/api/quota') {
      return json({ ok: true, freeDaily: 50, usage: 0, limitRemaining: 50, isFreeTier: true, source: 'server' });
    }
    if (url.pathname === '/api/budget') return json({ active: false, limit: 40, used: 0, remaining: 40 });
    if (url.pathname === '/api/processes') return json({ processes: [] });
    if (url.pathname === '/api/status') {
      return json({ summary: { requests: 0, ok: 0, successRate: 0, avgMs: null }, recent: [], cooling: [] });
    }
    return json({ ok: true });
  };
}

const chat = (id, title, content, at) => ({
  id,
  title,
  createdAt: at,
  updatedAt: at,
  messages: [{ role: 'user', content }],
});

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-store-warning-'));
  const workspace = path.join(temp, 'workspace');
  fs.mkdirSync(workspace);
  const config = path.join(temp, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ workspace }, null, 2));

  // A store the user could really end up with: both chat files unreadable, each
  // with one usable backup copy. The active file keeps one chat recoverable and
  // the archive keeps one chat to restore.
  const at = '2026-11-01T09:00:00.000Z';
  fs.writeFileSync(path.join(temp, 'threads.json'), '{ not json');
  fs.writeFileSync(
    path.join(temp, 'threads.json.bak'),
    JSON.stringify({ version: 1, threads: [chat('recovered-chat-1', 'Recovered chat', 'made it back', at)] }),
  );
  fs.writeFileSync(path.join(temp, 'threads-archive.json'), '{ not json');
  fs.writeFileSync(
    path.join(temp, 'threads-archive.json.bak'),
    JSON.stringify({ version: 1, threads: [chat('archived-chat-1', 'Archived chat', 'set aside', at)] }),
  );

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
    await waitForJson(`http://127.0.0.1:${appPort}/api/config`);

    const browser = await launchChrome({
      chromePath: chromeBin,
      userDataDir: path.join(temp, 'chrome'),
      viewport: { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false },
    });
    chrome = browser.chrome;
    cdp = browser.cdp;
    chromeLog = browser.log;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(${installHarness.toString()})();`,
    });

    const evaluate = (expression) => evaluatePage(cdp, expression);
    const waitFor = (expression, timeoutMs = 20_000) => waitForPage(cdp, expression, timeoutMs);
    const noteShown = "document.querySelector('#storeNote').hidden === false";
    const noteText = "document.querySelector('#storeNoteText').textContent";

    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${appPort}/` });
    await waitFor("Boolean(document.querySelector('#storeNote') && document.querySelector('#storeDismiss'))");

    await stage('a damaged store and archive are both explained in the sidebar', async () => {
      await waitFor(noteShown);
      const text = await evaluate(noteText);
      assert.match(text, /Your saved chats file was damaged/, `the banner does not mention the chats file: ${text}`);
      assert.match(text, /The archive of older chats was damaged/, `the banner does not mention the archive: ${text}`);
      const recovered = text.match(/came back from the last good copy/g) || [];
      assert.equal(recovered.length, 2, `both recoveries should be reported: ${text}`);
      // The recovered chat is listed, not an empty sidebar behind the banner.
      await waitFor("document.querySelectorAll('.thread-item').length === 1");
      return { text };
    });

    await stage('Dismiss clears the banner and it stays cleared after a reload', async () => {
      await evaluate("document.querySelector('#storeDismiss').click(); true");
      await waitFor("document.querySelector('#storeNote').hidden === true");
      // Dismiss is a server write, not just a hidden element: wait for the
      // stored warning to go, or the reload below would prove nothing.
      const warningFile = path.join(temp, 'threads-warning.json');
      const deadline = Date.now() + 5_000;
      while (fs.existsSync(warningFile) && Date.now() < deadline) await sleep(100);
      assert.equal(fs.existsSync(warningFile), false, 'Dismiss did not clear the stored warning');

      await cdp.send('Page.reload');
      await waitFor("Boolean(document.querySelector('#storeNote'))");
      await waitFor("document.querySelectorAll('.thread-item').length === 1");
      await sleep(300);
      const state = await evaluate(`(() => ({
        hidden: document.querySelector('#storeNote').hidden,
        text: document.querySelector('#storeNoteText').textContent,
      }))()`);
      assert.equal(state.hidden, true, `the banner came back after a reload: ${state.text}`);
      return { hidden: state.hidden };
    });
  } catch (error) {
    console.error('FAIL browser store warning:', error.message);
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
    console.error(`FAIL browser store warning: ${results.length - failed.length}/${results.length} stages passed.`);
    process.exitCode = 1;
  } else {
    console.log('PASS browser store warning: a damaged store and archive are explained, and Dismiss sticks.');
  }
}

await main();
