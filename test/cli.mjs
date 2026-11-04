// Checks the command-line flags, the saved-chat API and the single-file build.

import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const children = new Set();

function run(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, NO_OPEN: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.add(child);

  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => (out += chunk));
  child.stderr.on('data', (chunk) => (err += chunk));

  const done = new Promise((resolve) => {
    child.on('exit', (code) => {
      children.delete(child);
      resolve({ code, out, err });
    });
  });

  return { child, done };
}

async function waitFor(url, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/config`);
      if (response.ok) return true;
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server at ${url} did not start`);
}

/** Ask the OS for a free port instead of guessing one and colliding. */
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

async function startApp({ entry = 'app.mjs', args = [], env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-cli-'));
  const port = await freePort();
  // PORT is bogus on purpose: the flag has to win over the environment.
  const proc = run([entry, '--port', String(port), '--host', '127.0.0.1', ...args], {
    PORT: '1',
    OPENROUTER_CONFIG: path.join(dir, 'env-config.json'),
    ...env,
  });

  const base = `http://127.0.0.1:${port}`;
  await waitFor(base);

  const page = await (await fetch(`${base}/`)).text();
  const token = page.match(/const APP_TOKEN = "([A-Za-z0-9]+)"/)?.[1];
  assert.ok(token, 'the app token was not found in the page');

  return { dir, base, token, proc };
}

async function stopApp(app) {
  if (!app) return;
  app.proc.child.kill('SIGTERM');
  await app.proc.done;
}

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

async function main() {
  await check('--version prints the package version', async () => {
    const { done } = run(['app.mjs', '--version']);
    const result = await done;
    assert.equal(result.code, 0);
    assert.equal(result.out.trim(), pkg.version);
  });

  await check('--help explains the flags', async () => {
    const { done } = run(['app.mjs', '--help']);
    const result = await done;
    assert.equal(result.code, 0);
    assert.match(result.out, /--port/);
    assert.match(result.out, /--host/);
    assert.match(result.out, /--config/);
    assert.match(result.out, /127\.0\.0\.1/);
  });

  await check('rejects an impossible port', async () => {
    const { done } = run(['app.mjs', '--port', '99999']);
    const result = await done;
    assert.equal(result.code, 2);
    assert.match(result.err, /1 to 65535/);
  });

  await check('rejects an unknown flag', async () => {
    const { done } = run(['app.mjs', '--turbo']);
    const result = await done;
    assert.equal(result.code, 2);
    assert.match(result.err, /Unknown option/);
  });

  await check('--port overrides $PORT and serves the app', async () => {
    const app = await startApp();
    try {
      const config = await (await fetch(`${app.base}/api/config`)).json();
      assert.equal(config.version, pkg.version, '--port did not win over $PORT, or the version is stale');
    } finally {
      await stopApp(app);
    }
  });

  await check('saves, lists, searches and deletes chats', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const put = await fetch(`${app.base}/api/threads/chat-abc123`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hello bicycles' }] }),
      });
      assert.equal(put.status, 200);
      const saved = (await put.json()).thread;
      assert.equal(saved.title, 'hello bicycles');

      const list = (await (await fetch(`${app.base}/api/threads`, { headers })).json()).threads;
      assert.equal(list.length, 1);
      assert.equal(list[0].messageCount, 1);

      const byContent = (await (await fetch(`${app.base}/api/threads?q=bicycles`, { headers })).json()).threads;
      assert.equal(byContent.length, 1, 'search did not reach message text');

      const read = await (await fetch(`${app.base}/api/threads/chat-abc123`, { headers })).json();
      assert.equal(read.thread.messages[0].content, 'hello bicycles');

      assert.ok(
        fs.existsSync(path.join(app.dir, 'threads.json')),
        'threads.json was not written next to the config',
      );

      const del = await fetch(`${app.base}/api/threads/chat-abc123`, { method: 'DELETE', headers });
      assert.equal(del.status, 200);
      const after = (await (await fetch(`${app.base}/api/threads`, { headers })).json()).threads;
      assert.equal(after.length, 0);
    } finally {
      await stopApp(app);
    }
  });

  await check('a write from a stale tab is refused', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    const url = `${app.base}/api/threads/stale-tab-1`;
    try {
      const first = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'one' }] }),
      });
      const saved = (await first.json()).thread;
      assert.equal(saved.rev, 1);

      const stale = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ifRev: saved.rev - 1, messages: [{ role: 'user', content: 'stale' }] }),
      });
      assert.equal(stale.status, 409, 'a stale revision should be refused');
      const conflict = await stale.json();
      assert.equal(conflict.code, 'stale');
      assert.equal(conflict.thread.messages[0].content, 'one', 'the newer chat should come back');

      const fresh = await fetch(url, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ ifRev: saved.rev, messages: [{ role: 'user', content: 'two' }] }),
      });
      assert.equal(fresh.status, 200, 'the current revision should still write');
    } finally {
      await stopApp(app);
    }
  });

  await check('the files panel is gated and sandboxed', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    const workspace = path.join(app.dir, 'ws');
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, 'note.txt'), 'sandboxed');
    try {
      const denied = await fetch(`${app.base}/api/fs`);
      assert.equal(denied.status, 403, 'the files API must need the app token');

      const unset = await fetch(`${app.base}/api/fs`, { headers });
      assert.equal(unset.status, 400, 'no workspace folder should mean 400');

      const set = await fetch(`${app.base}/api/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspace }),
      });
      assert.equal(set.status, 200);

      const listing = await (await fetch(`${app.base}/api/fs?path=.`, { headers })).json();
      assert.ok(listing.entries.some((entry) => entry.name === 'note.txt'));

      const read = await (await fetch(`${app.base}/api/fs/read?path=note.txt`, { headers })).json();
      assert.equal(read.content, 'sandboxed');

      const escape = await fetch(
        `${app.base}/api/fs/read?path=${encodeURIComponent('../etc/passwd')}`,
        { headers },
      );
      assert.equal(escape.status, 400, 'traversal must be refused');

      const write = await fetch(`${app.base}/api/fs/write`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ path: 'made/up.txt', content: 'written' }),
      });
      assert.equal(write.status, 200);
      assert.equal(fs.readFileSync(path.join(workspace, 'made', 'up.txt'), 'utf8'), 'written');
    } finally {
      await stopApp(app);
    }
  });

  await check('secrets are write-only from the browser', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    const value = 'ghp_secret_value_123456';
    try {
      const saved = await fetch(`${app.base}/api/secrets`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'GITHUB_TOKEN', value }),
      });
      assert.equal(saved.status, 200);

      const listed = await (await fetch(`${app.base}/api/secrets`, { headers })).text();
      assert.ok(listed.includes('GITHUB_TOKEN'), 'the name is listed');
      assert.ok(!listed.includes(value), 'the API must never return a secret value');
      assert.ok(listed.includes('••••3456'), 'a four character hint is expected');

      const removed = await fetch(`${app.base}/api/secrets?name=GITHUB_TOKEN`, {
        method: 'DELETE',
        headers,
      });
      assert.equal(removed.status, 200);
      const after = await (await fetch(`${app.base}/api/secrets`, { headers })).json();
      assert.equal(after.names.length, 0);
    } finally {
      await stopApp(app);
    }
  });

  await check('a confirm for an unknown action is a 404', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/api/chat/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': app.token },
        body: JSON.stringify({ id: 'nope', allow: true }),
      });
      assert.equal(response.status, 404);
    } finally {
      await stopApp(app);
    }
  });

  await check('the GitHub API needs the app token and a saved secret', async () => {
    const app = await startApp();
    try {
      const denied = await fetch(`${app.base}/api/github?what=repos`);
      assert.equal(denied.status, 403);

      const missing = await fetch(`${app.base}/api/github?what=repos`, {
        headers: { 'x-app-token': app.token },
      });
      assert.equal(missing.status, 400);
      const body = await missing.json();
      assert.match(body.error, /GITHUB_TOKEN/);
    } finally {
      await stopApp(app);
    }
  });

  await check('a tokenless chat request is refused', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/api/threads`);
      assert.ok(response.status === 401 || response.status === 403, `got ${response.status}`);
    } finally {
      await stopApp(app);
    }
  });

  await check('the session reset needs the app token', async () => {
    const app = await startApp();
    try {
      const denied = await fetch(`${app.base}/api/session/reset`, { method: 'POST' });
      assert.equal(denied.status, 403);

      const allowed = await fetch(`${app.base}/api/session/reset`, {
        method: 'POST',
        headers: { 'x-app-token': app.token },
      });
      assert.equal(allowed.status, 200);
    } finally {
      await stopApp(app);
    }
  });

  await check('exports everything and imports it back', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      await fetch(`${app.base}/api/threads/export-me-1`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'export me' }] }),
      });

      const dump = await (await fetch(`${app.base}/api/export`, { headers })).json();
      assert.equal(dump.app, 'freeway');
      assert.equal(dump.version, pkg.version);
      assert.equal(typeof dump.settings.maxTokens, 'number');
      assert.equal(dump.threads.length, 1);
      assert.equal(dump.threads[0].messages[0].content, 'export me');

      const imported = await fetch(`${app.base}/api/import`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...dump, mode: 'replace' }),
      });
      assert.equal(imported.status, 200);

      const after = (await (await fetch(`${app.base}/api/threads`, { headers })).json()).threads;
      assert.equal(after.length, 1);
      assert.equal(after[0].id, 'export-me-1');
    } finally {
      await stopApp(app);
    }
  });

  await check('--config keeps the key, settings and chats in one folder', async () => {
    const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-config-'));
    const app = await startApp({ args: ['--config', custom] });
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      await fetch(`${app.base}/api/threads/moved-123456`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'moved' }] }),
      });
      assert.ok(
        fs.existsSync(path.join(custom, 'threads.json')),
        'threads.json did not land in the --config folder',
      );

      const save = await fetch(`${app.base}/api/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ settings: { maxTokens: 900 } }),
      });
      assert.equal(save.status, 200);
      assert.ok(
        fs.existsSync(path.join(custom, 'config.json')),
        'config.json did not land in the --config folder',
      );
    } finally {
      await stopApp(app);
    }
  });

  await check('OPENROUTER_LOCAL_CONFIG_DIR moves the folder too', async () => {
    const custom = fs.mkdtempSync(path.join(os.tmpdir(), 'openrouter-env-'));
    const app = await startApp({ env: { OPENROUTER_LOCAL_CONFIG_DIR: custom } });
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      await fetch(`${app.base}/api/threads/env-dir-1234`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'from the environment' }] }),
      });
      assert.ok(
        fs.existsSync(path.join(custom, 'threads.json')),
        'the environment variable did not win over OPENROUTER_CONFIG',
      );
    } finally {
      await stopApp(app);
    }
  });

  await check('sends a strict content security policy', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/`);
      const csp = response.headers.get('content-security-policy') ?? '';
      assert.match(csp, /default-src 'self'/);
      assert.match(csp, /script-src 'self' 'unsafe-inline'/);
      assert.match(csp, /frame-ancestors 'none'/);
      // The preview panel frames a local dev server, and nothing else.
      assert.match(csp, /frame-src http: https:/);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-frame-options'), 'DENY');
    } finally {
      await stopApp(app);
    }
  });

  await check('gzip the page when asked, and send it whole', async () => {
    const app = await startApp();
    try {
      const plain = await (await fetch(`${app.base}/`)).text();
      const zipped = await fetch(`${app.base}/`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(zipped.headers.get('content-encoding'), 'gzip');
      assert.match(zipped.headers.get('vary') ?? '', /accept-encoding/);
      const body = await zipped.text();
      // The whole document, not a truncated prefix: this is what the tunnel was
      // cutting off before the page was compressed.
      assert.equal(body.length, plain.length);
      assert.match(body, /<\/html>/);

      // The catalog is the big one: uncompressed it stalled the boot over the
      // tunnel, so it must arrive compressed while small blobs stay plain.
      const models = await fetch(`${app.base}/api/models`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(models.headers.get('content-encoding'), 'gzip');
      assert.ok((await models.json()).models.length > 0);
      const small = await fetch(`${app.base}/api/config`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(small.headers.get('content-encoding'), null);
    } finally {
      await stopApp(app);
    }
  });

  await check('remembers a preview address per chat, http(s) only', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const created = await (
        await fetch(`${app.base}/api/threads/preview-chat-1`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ messages: [{ role: 'user', content: 'preview' }] }),
        })
      ).json();

      const saved = await fetch(`${app.base}/api/preview/preview-chat-1`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'http://localhost:5173' }),
      });
      assert.equal(saved.status, 200);
      // Stored the way the URL parser sees it: a bare host gains its slash.
      assert.equal((await saved.json()).thread.preview, 'http://localhost:5173/');

      const bad = await fetch(`${app.base}/api/preview/preview-chat-1`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'javascript:alert(1)' }),
      });
      assert.equal((await bad.json()).thread.preview, '', 'a javascript: URL must be dropped');

      const missing = await fetch(`${app.base}/api/preview/no-such-chat-99`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ url: 'http://localhost:3000' }),
      });
      assert.equal(missing.status, 404);

      const unauth = await fetch(`${app.base}/api/preview/preview-chat-1`, { method: 'POST' });
      assert.equal(unauth.status, 403);

      const reread = await (
        await fetch(`${app.base}/api/threads/preview-chat-1`, { headers })
      ).json();
      assert.equal(reread.thread.preview, '');
      assert.equal(reread.thread.rev, created.thread.rev, 'a preview must not bump rev');
    } finally {
      await stopApp(app);
    }
  });

  await check('the page ships the preview panel in a sandboxed frame', async () => {
    const app = await startApp();
    try {
      const html = await (await fetch(`${app.base}/`)).text();
      assert.match(html, /id="railPreview"/);
      assert.match(html, /sandbox="allow-scripts allow-same-origin/);
      assert.match(html, /data-rail="preview"/);
    } finally {
      await stopApp(app);
    }
  });

  await check('the status route reports this run and is read-only', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/api/status`);
      assert.equal(response.status, 200, 'status must not need the app token');
      const body = await response.json();
      assert.equal(body.version, pkg.version);
      assert.equal(body.summary.requests, 0);
      assert.equal(body.summary.successRate, null, 'no attempts is not "0%"');
      assert.deepEqual(body.cooling, []);
      assert.deepEqual(body.recent, []);
      assert.equal(body.limits.attempts, 3);
      assert.equal(typeof body.catalog.models, 'number');

      // A stale route would pass the JSON check but leave the tab unreachable.
      const html = await (await fetch(`${app.base}/`)).text();
      assert.match(html, /id="railStatus"/);
      assert.match(html, /data-rail="status"/);
    } finally {
      await stopApp(app);
    }
  });

  await check('rejects a chat body over 1.5 MB before forwarding', async () => {
    // A key is needed to get past the early "no key" check and reach the body
    // limit; nothing is forwarded, because the body is rejected first.
    const app = await startApp({ env: { OPENROUTER_API_KEY: 'sk-or-v1-0123456789abcdef' } });
    try {
      const response = await fetch(`${app.base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': app.token },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'x'.repeat(1_600_000) }] }),
      });
      assert.equal(response.status, 413);
      const body = await response.json();
      assert.match(body.error, /too large/);
    } finally {
      await stopApp(app);
    }
  });

  await check('refuses to send a model when free pricing cannot be verified', async () => {
    // With no reachable catalog nothing can be checked against live pricing, so
    // a client-supplied id (paid, or stale) must not be forwarded.
    const app = await startApp({
      env: {
        OPENROUTER_API_KEY: 'sk-or-v1-0123456789abcdef',
        OPENROUTER_BASE_URL: 'http://127.0.0.1:1',
      },
    });
    try {
      const response = await fetch(`${app.base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-app-token': app.token },
        body: JSON.stringify({ model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(response.status, 502, `got ${response.status}`);
      const body = await response.json();
      assert.match(body.error, /catalog is unavailable/i);
    } finally {
      await stopApp(app);
    }
  });

  const single = path.join(root, 'freeway.mjs');
  if (fs.existsSync(single)) {
    await check('the single-file build runs standalone', async () => {
      const app = await startApp({ entry: 'freeway.mjs' });
      try {
        const config = await (await fetch(`${app.base}/api/config`)).json();
        assert.equal(config.version, pkg.version);
      } finally {
        await stopApp(app);
      }
    });
  }

  let failed = 0;
  for (const result of results) {
    if (result.ok) {
      console.log(`  PASS  ${result.name}`);
    } else {
      failed += 1;
      console.log(`  FAIL  ${result.name}`);
      console.log(`        ${result.error?.message ?? result.error}`);
    }
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  for (const child of children) child.kill('SIGKILL');
  console.error('cli test crashed:', error);
  process.exit(1);
});
