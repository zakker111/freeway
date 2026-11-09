import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  browserLaunchArgs,
  browserShouldRecheck,
  browserUrlAllowed,
  createBrowserManager,
  formatBrowserSnapshot,
} from './browser.mjs';
import { runTool } from './tools.mjs';
import { withToolInstruction } from './tool-prompt.mjs';

test('the interactive browser only accepts local preview URLs', () => {
  assert.equal(browserUrlAllowed('http://127.0.0.1:3002/preview'), true);
  assert.equal(browserUrlAllowed('http://localhost:3002/'), true);
  assert.equal(browserUrlAllowed('http://[::1]:3002/'), true);
  for (const blocked of [
    'https://example.com/',
    'http://192.168.0.1/',
    'http://127.0.0.1.evil.test/',
    'http://user:pass@127.0.0.1:3002/',
    'file:///etc/passwd',
    'not a url',
  ]) {
    assert.equal(browserUrlAllowed(blocked), false, blocked);
  }
});

test('browser launch args are isolated, bounded and interactive', () => {
  const args = browserLaunchArgs({
    profile: '/tmp/freeway-profile',
    port: 9333,
    width: 390,
    height: 844,
  });
  assert.ok(args.includes('--headless'));
  assert.ok(args.includes('--remote-debugging-port=9333'));
  assert.ok(args.includes('--user-data-dir=/tmp/freeway-profile'));
  assert.ok(args.includes('--window-size=390,844'));
  assert.equal(args.some((arg) => arg.startsWith('--remote-allow-origins')), false);
  assert.equal(args.at(-1), 'about:blank');
  assert.equal(args.some((arg) => arg.startsWith('--screenshot=')), false);
});

test('an open browser is rechecked only after a page edit', () => {
  assert.equal(browserShouldRecheck('write_file', 'index.html'), true);
  assert.equal(browserShouldRecheck('write_file', 'styles.css'), true);
  assert.equal(browserShouldRecheck('apply_patch', 'app.js'), true);
  assert.equal(browserShouldRecheck('write_file', 'README.md'), true);
  assert.equal(browserShouldRecheck('write_file', 'package.json'), false);
  assert.equal(browserShouldRecheck('scaffold_project', ''), true);
  assert.equal(browserShouldRecheck('read_file', 'index.html'), false);
  assert.equal(browserShouldRecheck('run_command', 'index.html'), false);
});

test('browser snapshots are readable, bounded and include diagnostics', () => {
  const text = formatBrowserSnapshot(
    {
      title: 'Checkout',
      url: 'http://127.0.0.1:4567/__freeway_preview__/abc/index.html',
      text: 'Order summary',
      elements: [
        { uid: 'e1', role: 'button', name: 'Pay now', tag: 'button' },
        { uid: 'e2', role: 'input', name: 'Email', tag: 'input', type: 'email', value: 'a@b.test' },
      ],
    },
    {
      console: ['error: payment failed'],
      network: ['500 POST http://127.0.0.1:4567/api/pay'],
    },
  );
  assert.match(text, /Browser page: Checkout/);
  assert.match(text, /Visible text:\nOrder summary/);
  assert.match(text, /e1 button "Pay now"/);
  assert.match(text, /e2 input "Email" type=email/);
  assert.match(text, /Console:\n- error: payment failed/);
  assert.match(text, /Network problems:\n- 500 POST/);
  assert.ok(text.length < 30_000);
});

test('browser tools require the desktop browser context', async () => {
  const missing = await runTool('browser_snapshot', {}, {});
  assert.equal(missing.ok, false);
  assert.match(missing.content, /desktop app/);

  const missingBrowser = await runTool('browser_open', { entry: 'index.html' }, {});
  assert.equal(missingBrowser.ok, false);
  assert.match(missingBrowser.content, /desktop app/);
});

test('browser_open obtains the local preview URL and opens it', async () => {
  const calls = [];
  const manager = {
    open: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, content: 'opened' };
    },
  };
  const result = await runTool(
    'browser_open',
    { entry: 'index.html', viewport: 'mobile' },
    {
      browser: manager,
      previewLink: async (entry) => ({
        ok: true,
        entry,
        url: 'http://127.0.0.1:4567/__freeway_preview__/abc/index.html',
      }),
    },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:4567/__freeway_preview__/abc/index.html',
      options: { entry: 'index.html', viewport: 'mobile' },
    },
  ]);
});

test('browser action tools pass uids and return the manager result', async () => {
  const calls = [];
  const manager = {
    snapshotResult: async () => ({ ok: true, content: 'snapshot' }),
    click: async (uid) => {
      calls.push(['click', uid]);
      return { ok: true, content: `clicked ${uid}` };
    },
    type: async (uid, text, submit) => {
      calls.push(['type', uid, text, submit]);
      return { ok: true, content: `typed ${uid}` };
    },
    close: async () => {
      calls.push(['close']);
      return { ok: true };
    },
  };

  assert.equal((await runTool('browser_snapshot', {}, { browser: manager })).content, 'snapshot');
  assert.equal((await runTool('browser_click', { uid: 'e1' }, { browser: manager })).ok, true);
  assert.equal(
    (await runTool('browser_type', { uid: 'e2', text: 'hello', submit: true }, { browser: manager })).ok,
    true,
  );
  assert.equal((await runTool('browser_close', {}, { browser: manager })).ok, true);
  assert.deepEqual(calls, [
    ['click', 'e1'],
    ['type', 'e2', 'hello', true],
    ['close'],
  ]);
});

test('the browser tool prompt tells the model to inspect action results', () => {
  const messages = withToolInstruction(
    [{ role: 'user', content: 'change the page' }],
    [{ type: 'function', function: { name: 'browser_open' } }],
  );
  assert.match(messages[0].content, /browser_open/);
  assert.match(messages[0].content, /browser_snapshot/);
  assert.match(messages[0].content, /console and network/);
});

test('a missing local browser is an actionable failure', async () => {
  const manager = createBrowserManager({ findBrowserImpl: () => null });
  await assert.rejects(
    () => manager.open('http://127.0.0.1:3002/preview'),
    /No local Edge or Chrome/,
  );
});

test('the single-file build includes the browser module', () => {
  const bundle = fs.readFileSync(new URL('../build/bundle.mjs', import.meta.url), 'utf8');
  assert.match(bundle, /lib\/browser\.mjs/, 'bundle.mjs would omit the browser implementation');
  assert.match(bundle, /\$\{browserMod\.code\}/, 'bundle output would omit the browser implementation');
});
