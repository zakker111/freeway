import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createWorkspace } from './workspace.mjs';
import { createPreviewServer } from './preview-server.mjs';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freeway-preview-'));
  const root = path.join(dir, 'site');
  fs.mkdirSync(path.join(root, 'app'), { recursive: true });
  fs.mkdirSync(path.join(root, 'site'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/style.css"></head>' +
      '<body><img src="/art.png"><script type="module" src="/app.js"></script></body></html>',
  );
  fs.writeFileSync(path.join(root, 'style.css'), 'body { color: red; }');
  fs.writeFileSync(path.join(root, 'app.js'), 'import { x } from "./x.js"; fetch("/data.json");');
  fs.writeFileSync(path.join(root, 'x.js'), 'export const x = 1;');
  fs.writeFileSync(path.join(root, 'data.json'), '{"ok":true}');
  fs.writeFileSync(path.join(root, 'art.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
  fs.writeFileSync(path.join(root, '.env'), 'SECRET=nope');
  fs.writeFileSync(path.join(root, 'site', 'index.html'), '<html><head></head><body>nested</body></html>');
  fs.writeFileSync(path.join(root, 'site', 'style.css'), 'h1 { color: blue; }');
  const outside = path.join(dir, 'outside.txt');
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(root, 'escape.txt'));
  fs.symlinkSync(path.join(root, '.env'), path.join(root, 'secret-link.txt'));
  return { dir, root, ws: createWorkspace(root) };
}

function request(port, target, { cookie = '', method = 'GET', accept = '*/*' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: target,
        method,
        headers: { accept, ...(cookie ? { cookie } : {}) },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function cookieFrom(response) {
  const raw = response.headers['set-cookie']?.[0] ?? '';
  return raw.split(';')[0];
}

test('preview server exchanges a token for a loopback cookie and serves modules', async (t) => {
  const { ws } = fixture();
  const server = createPreviewServer({ getWorkspace: () => ws, appPort: 3002 });
  t.after(() => server.close());
  const opened = await server.open('index.html', { host: '127.0.0.1' });
  assert.match(opened.url, /^http:\/\/127\.0\.0\.1:\d+\/__freeway_preview__\/[a-f0-9]{64}\/index\.html$/);

  const handoff = await request(server.port, new URL(opened.url).pathname);
  assert.equal(handoff.status, 302);
  assert.equal(handoff.headers.location, '/index.html');
  assert.match(handoff.headers['set-cookie'][0], /HttpOnly/);
  assert.match(handoff.headers['set-cookie'][0], /SameSite=Lax/);
  assert.match(handoff.headers['set-cookie'][0], /Path=\//);

  const cookie = cookieFrom(handoff);
  const page = await request(server.port, '/index.html', { cookie, accept: 'text/html' });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.match(page.body.toString(), /type="module"/);
  assert.match(page.body.toString(), /data-freeway-preview-bridge/);
  assert.match(page.body.toString(), /freeway-preview/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors http:\/\/127\.0\.0\.1:3002/);

  const head = await request(server.port, '/index.html', { cookie, method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0, 'HEAD must not send a body');

  const module = await request(server.port, '/app.js', { cookie });
  assert.equal(module.status, 200);
  assert.match(module.headers['content-type'], /text\/javascript/);
  assert.match(module.body.toString(), /import \{ x \}/);

  const absolute = await request(server.port, '/data.json', { cookie });
  assert.equal(absolute.status, 200);
  assert.match(absolute.headers['content-type'], /application\/json/);

  const image = await request(server.port, '/art.png', { cookie });
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/png');
  assert.deepEqual([...image.body], [0x89, 0x50, 0x4e, 0x47, 0, 1, 2]);

  await server.close();
});

test('preview server refuses missing cookies, traversal, hidden files and symlinks', async (t) => {
  const { ws } = fixture();
  const server = createPreviewServer({ getWorkspace: () => ws });
  t.after(() => server.close());
  const opened = await server.open('index.html');
  const handoff = await request(server.port, new URL(opened.url).pathname);
  const cookie = cookieFrom(handoff);

  const noCookie = await request(server.port, '/index.html');
  assert.equal(noCookie.status, 404);
  assert.equal(noCookie.body.toString(), 'Not found.\n');

  const badToken = await request(server.port, '/__freeway_preview__/deadbeef/index.html');
  assert.equal(badToken.status, 404);

  for (const target of [
    '/../outside.txt',
    '/%2e%2e/outside.txt',
    '/.env',
    '/secret-link.txt',
    '/escape.txt',
    '/node_modules/x.js',
  ]) {
    const response = await request(server.port, target, { cookie });
    assert.equal(response.status, 404, `${target} should not be served`);
  }

  const write = await request(server.port, '/index.html', { cookie, method: 'POST' });
  assert.equal(write.status, 405);
  assert.match(write.headers.allow, /GET/);

  await server.close();
});

test('preview server handles directories, SPA routes and a nested entry', async (t) => {
  const { ws } = fixture();
  const server = createPreviewServer({ getWorkspace: () => ws });
  t.after(() => server.close());
  const opened = await server.open('site/index.html');
  const handoff = await request(server.port, new URL(opened.url).pathname);
  const cookie = cookieFrom(handoff);

  const root = await request(server.port, '/', { cookie, accept: 'text/html' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.location, '/site/index.html');

  const directory = await request(server.port, '/site', { cookie, accept: 'text/html' });
  assert.equal(directory.status, 301);
  assert.equal(directory.headers.location, '/site/');

  const slash = await request(server.port, '/site/', { cookie, accept: 'text/html' });
  assert.equal(slash.status, 200);
  assert.match(slash.body.toString(), /nested/);

  const css = await request(server.port, '/site/style.css', { cookie });
  assert.equal(css.status, 200);
  assert.match(css.headers['content-type'], /text\/css/);

  const spa = await request(server.port, '/about', { cookie, accept: 'text/html' });
  assert.equal(spa.status, 200);
  assert.match(spa.body.toString(), /<base href="\/site\/">/);

  const missing = await request(server.port, '/missing.js', { cookie });
  assert.equal(missing.status, 404);

  await server.close();
});

test('a restarted preview server invalidates the old token', async (t) => {
  const { ws } = fixture();
  const first = createPreviewServer({ getWorkspace: () => ws });
  t.after(() => first.close());
  const opened = await first.open('index.html');
  const handoff = await request(first.port, new URL(opened.url).pathname);
  const oldCookie = cookieFrom(handoff);
  const oldPort = first.port;
  await first.close();

  const second = createPreviewServer({ getWorkspace: () => ws });
  t.after(() => second.close());
  await second.open('index.html');
  const stale = await request(second.port, '/index.html', { cookie: oldCookie });
  assert.equal(stale.status, 404);
  assert.ok(second.port > 0);
  await second.close();
});
