// Checks the command-line flags, the saved-chat API and the single-file build.

import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
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

/** fetch() refuses to spoof Host, so the header tests use raw HTTP. */
function rawGet(base, target, headers = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: url.hostname, port: url.port, path: target, method: 'GET', headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    req.end();
  });
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

  await check('a malformed chat id is a 400, not a crash', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/api/threads/%`, {
        headers: { 'x-app-token': app.token },
      });
      assert.equal(response.status, 400, 'a bad % escape must be a client error');
      assert.doesNotMatch(await response.text(), /URI malformed/, 'the raw decoder error reached the page');
    } finally {
      await stopApp(app);
    }
  });

  await check('HEAD / reports the page without a body', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/`, { method: 'HEAD' });
      assert.equal(response.status, 200, 'a monitor cannot check the page');
      assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
      assert.ok(Number(response.headers.get('content-length')) > 1000, 'HEAD lost the page length');
      assert.equal(await response.text(), '', 'HEAD returned a body');
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
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'hello bicycles' }],
          model: 'mock/alpha-free',
        }),
      });
      assert.equal(put.status, 200);
      const saved = (await put.json()).thread;
      assert.equal(saved.title, 'hello bicycles');
      assert.equal(saved.model, 'mock/alpha-free', 'the thread model was not saved');

      const list = (await (await fetch(`${app.base}/api/threads`, { headers })).json()).threads;
      assert.equal(list.length, 1);
      assert.equal(list[0].messageCount, 1);

      const byContent = (await (await fetch(`${app.base}/api/threads?q=bicycles`, { headers })).json()).threads;
      assert.equal(byContent.length, 1, 'search did not reach message text');

      const read = await (await fetch(`${app.base}/api/threads/chat-abc123`, { headers })).json();
      assert.equal(read.thread.messages[0].content, 'hello bicycles');
      assert.equal(read.thread.model, 'mock/alpha-free', 'the thread model did not round-trip');

      // A file-only draft must survive the save route too, not just the store.
      const draftResponse = await fetch(`${app.base}/api/threads`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title: 'New chat', messages: [], workspace: '' }),
      });
      assert.equal(draftResponse.status, 200);
      const draft = (await draftResponse.json()).thread;
      assert.equal(draft.messages.length, 0);
      const draftRead = await (await fetch(`${app.base}/api/threads/${draft.id}`, { headers })).json();
      assert.equal(draftRead.thread.messages.length, 0, 'the empty draft did not round-trip');
      const draftList = (await (await fetch(`${app.base}/api/threads`, { headers })).json()).threads;
      assert.equal(draftList.length, 2, 'the empty draft is missing from the sidebar list');
      assert.ok(draftList.some((thread) => thread.id === draft.id), 'the empty draft has no list entry');

      assert.ok(
        fs.existsSync(path.join(app.dir, 'threads.json')),
        'threads.json was not written next to the config',
      );

      const del = await fetch(`${app.base}/api/threads/chat-abc123`, { method: 'DELETE', headers });
      assert.equal(del.status, 200);
      const delDraft = await fetch(`${app.base}/api/threads/${draft.id}`, { method: 'DELETE', headers });
      assert.equal(delDraft.status, 200);
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

  await check('a new chat gets its own files', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    const alpha = 'chat-alpha-1';
    const beta = 'chat-beta-1';
    try {
      const write = await fetch(`${app.base}/api/fs/write`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ chat: alpha, workspace: '', path: 'alpha.txt', content: 'alpha' }),
      });
      assert.equal(write.status, 200);
      assert.equal(fs.readFileSync(path.join(app.dir, 'workspaces', alpha, 'alpha.txt'), 'utf8'), 'alpha');

      const alphaList = await (
        await fetch(`${app.base}/api/fs?path=.&chat=${alpha}&workspace=`, { headers })
      ).json();
      assert.ok(alphaList.entries.some((entry) => entry.name === 'alpha.txt'));
      const betaList = await (
        await fetch(`${app.base}/api/fs?path=.&chat=${beta}&workspace=`, { headers })
      ).json();
      assert.equal(betaList.entries.length, 0, 'the second chat inherited the first chat files');

      const save = await fetch(`${app.base}/api/threads/${alpha}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'alpha chat' }], workspace: '' }),
      });
      assert.equal(save.status, 200);
      const saved = await (await fetch(`${app.base}/api/threads/${alpha}`, { headers })).json();
      assert.equal(saved.thread.workspace, '', 'the managed workspace policy was not saved');
    } finally {
      await stopApp(app);
    }
  });

  await check('rejects null JSON and malformed chat ids', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const nullBody = await fetch(`${app.base}/api/config`, {
        method: 'POST',
        headers,
        body: 'null',
      });
      assert.equal(nullBody.status, 400, 'JSON null must not become a 500');
      assert.match((await nullBody.json()).error, /object|JSON/i);

      const badId = await fetch(`${app.base}/api/threads/bad!id`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ messages: [{ role: 'user', content: 'bad id' }] }),
      });
      assert.equal(badId.status, 400, 'a malformed thread id must be refused before storage');
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
      assert.match(body.error, /Connect GitHub/);
    } finally {
      await stopApp(app);
    }
  });

  await check('GitHub connect and clone refuse empty credentials without network', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const denied = await fetch(`${app.base}/api/github/connect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'ghp_never_sent' }),
      });
      assert.equal(denied.status, 403);

      const empty = await fetch(`${app.base}/api/github/connect`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ token: '   ' }),
      });
      assert.equal(empty.status, 400);
      assert.match((await empty.json()).error, /Paste a GitHub token/);

      const clone = await fetch(`${app.base}/api/github/clone`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ repo: 'zakker111/freeway' }),
      });
      assert.equal(clone.status, 400);
      assert.match((await clone.json()).error, /Connect GitHub/);
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
    // Simulate a config created by an older build with a permissive mode.
    fs.writeFileSync(path.join(custom, 'config.json'), JSON.stringify({ apiKey: 'old' }));
    fs.chmodSync(path.join(custom, 'config.json'), 0o644);
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
      if (process.platform !== 'win32') {
        const mode = fs.statSync(path.join(custom, 'config.json')).mode & 0o777;
        assert.equal(mode, 0o600, `config.json should be private, got ${mode.toString(8)}`);
      }
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

  await check('serves a workspace preview through a tokenised loopback server', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const unauth = await fetch(`${app.base}/api/preview/serve`, { method: 'POST' });
      assert.equal(unauth.status, 403);

      const noWorkspace = await fetch(`${app.base}/api/preview/serve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entry: 'index.html' }),
      });
      assert.equal(noWorkspace.status, 400);

      const site = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-server-preview-'));
      fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>served</title><h1>preview works</h1>');
      fs.writeFileSync(path.join(site, 'style.css'), 'h1 { color: green; }');
      const configured = await fetch(`${app.base}/api/config`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workspace: site }),
      });
      assert.equal(configured.status, 200);

      const discovered = await fetch(`${app.base}/api/fs/preview-entry`, { headers });
      assert.equal(discovered.status, 200);
      assert.equal((await discovered.json()).entry, 'index.html');

      const response = await fetch(`${app.base}/api/preview/serve`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ entry: 'index.html', host: '127.0.0.1' }),
      });
      assert.equal(response.status, 200);
      const served = await response.json();
      assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/__freeway_preview__\/[a-f0-9]{64}\/index\.html$/);

      const handoff = await fetch(served.url, { redirect: 'manual' });
      assert.equal(handoff.status, 302);
      const cookie = (handoff.headers.get('set-cookie') ?? '').split(';')[0];
      assert.match(cookie, /^freeway_preview=[a-f0-9]{64}$/);
      const target = new URL(handoff.headers.get('location'), served.url).toString();
      const page = await fetch(target, { headers: { cookie } });
      assert.equal(page.status, 200);
      assert.match(await page.text(), /preview works/);
      assert.match(page.headers.get('content-type') ?? '', /text\/html/);
    } finally {
      await stopApp(app);
    }
  });

  if (process.platform !== 'win32') {
    await check('captures a user preview as a PNG without a model', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-shot-'));
      const browser = path.join(dir, 'fake-browser.cjs');
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
      fs.writeFileSync(browser, `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst out = process.argv.find((a) => a.startsWith('--screenshot=')).slice('--screenshot='.length);\nfs.writeFileSync(out, Buffer.from('${png}', 'base64'));\n`);
      fs.chmodSync(browser, 0o755);
      const app = await startApp({ env: { FREEWAY_BROWSER: browser } });
      const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
      try {
        const unauth = await fetch(`${app.base}/api/preview/screenshot`, { method: 'POST' });
        assert.equal(unauth.status, 403);
        const noWorkspace = await fetch(`${app.base}/api/preview/screenshot`, {
          method: 'POST', headers, body: JSON.stringify({ entry: 'index.html' }),
        });
        assert.equal(noWorkspace.status, 400);

        const site = path.join(dir, 'site');
        fs.mkdirSync(site);
        fs.writeFileSync(path.join(site, 'index.html'), '<!doctype html><title>shot</title><h1>shot</h1>');
        await fetch(`${app.base}/api/config`, {
          method: 'POST', headers, body: JSON.stringify({ workspace: site }),
        });
        const response = await fetch(`${app.base}/api/preview/screenshot`, {
          method: 'POST', headers,
          body: JSON.stringify({ entry: 'index.html', viewport: 'mobile' }),
        });
        assert.equal(response.status, 200);
        const shot = await response.json();
        assert.match(shot.image, /^data:image\/png;base64,/);
        assert.equal(shot.entry, 'index.html');
        assert.equal(shot.viewport, 'mobile');
        assert.equal(shot.width, 1);
        assert.equal(shot.height, 1);

        const rejected = await fetch(`${app.base}/api/preview/screenshot`, {
          method: 'POST', headers, body: JSON.stringify({ url: 'https://example.com/' }),
        });
        assert.equal(rejected.status, 500);
      } finally {
        await stopApp(app);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  await check('managed processes are token-gated and start empty', async () => {
    const app = await startApp();
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const unauth = await fetch(`${app.base}/api/processes`);
      assert.equal(unauth.status, 403);

      const listed = await (await fetch(`${app.base}/api/processes`, { headers })).json();
      assert.ok(Array.isArray(listed.processes), 'no process list');
      assert.equal(listed.processes.length, 0);
      assert.equal(listed.limits.maxProcesses, 3);

      const missing = await fetch(`${app.base}/api/processes/stop`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id: 'dev-404' }),
      });
      assert.equal(missing.status, 404);

      const all = await (
        await fetch(`${app.base}/api/processes/stop`, {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        })
      ).json();
      assert.deepEqual(all.stopped, []);
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
    const app = await startApp({ env: { OPENROUTER_API_KEY: ['sk-or-v1-', 'c'.repeat(32)].join('') } });
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

  await check('refuses a foreign Host before serving the token page', async () => {
    const app = await startApp();
    try {
      for (const host of ['evil.example', '127.0.0.1.evil.test', '127.0.0.1.nip.io']) {
        const response = await rawGet(app.base, '/', { host });
        assert.equal(response.status, 403, `${host} was accepted as loopback`);
        assert.doesNotMatch(response.body, /const APP_TOKEN/);
      }
    } finally {
      await stopApp(app);
    }
  });

  await check('refuses cross-origin mutations but accepts same-origin ones', async () => {
    const app = await startApp();
    const url = `${app.base}/api/threads/origin-chat-1`;
    const headers = { 'content-type': 'application/json', 'x-app-token': app.token };
    try {
      const foreign = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, origin: 'https://evil.example' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'foreign' }] }),
      });
      assert.equal(foreign.status, 403);

      const same = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, origin: app.base },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'same origin' }] }),
      });
      assert.equal(same.status, 200);
    } finally {
      await stopApp(app);
    }
  });

  await check('/api/key requires the app token', async () => {
    const app = await startApp();
    try {
      const response = await fetch(`${app.base}/api/key`);
      assert.equal(response.status, 403);
    } finally {
      await stopApp(app);
    }
  });

  await check('/api/key scrubs a key echoed by the provider', async () => {
    const key = ['sk-or-v1-', 'c'.repeat(32)].join('');
    const upstream = http.createServer((req, res) => {
      if (req.url === '/api/v1/key') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `Incorrect API key provided: ${key}` } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const port = upstream.address().port;
    const app = await startApp({
      env: { OPENROUTER_API_KEY: key, OPENROUTER_BASE_URL: `http://127.0.0.1:${port}/api/v1` },
    });
    try {
      const response = await fetch(`${app.base}/api/key`, { headers: { 'x-app-token': app.token } });
      assert.equal(response.status, 502);
      const body = await response.text();
      assert.equal(body.includes(key), false, 'the rejected key was echoed to the page');
      assert.match(body, /sk-or-\[redacted\]/);
    } finally {
      await stopApp(app);
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  await check('refuses to send a model when free pricing cannot be verified', async () => {
    // With no reachable catalog nothing can be checked against live pricing, so
    // a client-supplied id (paid, or stale) must not be forwarded.
    const app = await startApp({
      env: {
        OPENROUTER_API_KEY: ['sk-or-v1-', 'c'.repeat(32)].join(''),
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
    // The bundler inlines an explicit module list, and a relative import it does
    // not know about is dropped silently: the bundle then loads but dies inside
    // the route that uses the missing names. 2.34.0 shipped that bug once
    // (lib/chats.mjs was in app.mjs but not in build/bundle.mjs).
    await check('the single-file build inlines every lib module', async () => {
      const bundle = fs.readFileSync(single, 'utf8');
      const modules = fs
        .readdirSync(path.join(root, 'lib'))
        .filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs'));
      const missing = modules.filter((name) => !bundle.includes(`lib/${name}`));
      assert.deepEqual(missing, [], `missing from the bundle: ${missing.join(', ')}`);
    });

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
